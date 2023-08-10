const fs = require("fs");
const ethers = require("ethers");
const axios = require("axios").default;
const puppeteer = require("puppeteer-extra").default;
puppeteer.use(require("puppeteer-extra-plugin-stealth")());

const ABI = require("./factoryABI.json");

const TOKENSNIFFER_MIN_SR = 90;
const GOPLUS_MIN_SR = 80;

let browser;
let page;

const initBrowser = async () => {
    log("Sniper", "Initializing Browser");
    browser = await puppeteer.launch({
        timeout: 0,
        slowMo: 50,
        ignoreHTTPSErrors: true,
        headless: "new",
        args: [
            "--start-maximized",
            "--no-sandbox",
            "--disable-setuid-sandbox",
        ],
        ignoreDefaultArgs: ["--disable-extensions", "--enable-automation"]
    });

    page = await browser.newPage();
    page.setDefaultNavigationTimeout(0);

    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36");
    await page.setCookie(
        {
            name: "cf_clearance",
            value: "z2ta64DJxkJ_Qbqf01GlzTUsC4Kxu1JZvR3UXDZfNvI-1691498280-0-1-9a8d69fd.d898ccc3.f9afc5c9-160.0.0",
            domain: ".tokensniffer.com",
            path: "/",
            httpOnly: true,
            secure: true
        }
    )
};

const log = (func, msg) => {
    const time = new Date().toLocaleString();

    if (func.length == 0) {
        console.log("");
    } else {
        console.log(`[${time}] [${func}] - ${msg}`);
    }
};

const doTokenSnifferScan = async (token) => {
    try {
        await page.goto(`https://tokensniffer.com/token/eth/${token}`, { waitUntil: "networkidle0" });
        await page.waitForSelector("table tbody h2 span", { timeout: 0 });

        let score = await page.$eval("table tbody h2 span", el => el.textContent);
        score = parseInt(score.split("/")[0]);

        // log("TokenSniffer", `Score is ${score}`);

        return { success: (score >= TOKENSNIFFER_MIN_SR) ? true : false, score };
    } catch (error) {
        log("Sniper - TokenSniffer", error);
    }

    return { success: false, score: 0 };
};

const doGoPlusScan = async (token) => {
    try {
        const headers = {
            authority: "api.gopluslabs.io",
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            Dnt: "1",
            Referer: "https://gopluslabs.io/",
            "Sec-Ch-Ua": '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"

        };

        const res = await axios.get(`https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses=${token}`, { headers: headers });

        const keys = [
            { "anti_whale_modifiable": "0" },
            { "buy_tax": "0.1" },
            { "can_take_back_ownership": "0" },
            { "cannot_buy": "0" },
            { "cannot_sell_all": "0" },
            { "creator_percent": "0.05" },
            { "external_call": "0" },
            { "hidden_owner": "0" },
            { "honeypot_with_same_creator": "0" },
            { "is_anti_whale": "0" },
            { "is_blacklisted": "0" },
            { "is_honeypot": "0" },
            { "is_in_dex": "1" },
            { "is_mintable": "0" },
            { "is_open_source": "1" },
            { "is_proxy": "0" },
            { "is_whitelisted": "0" },
            { "liq_locked": "0.95" },
            { "owner_percent": "0.05" },
            { "personal_slippage_modifiable": "0" },
            { "selfdestruct": "0" },
            { "sell_tax": "0.1" },
            { "slippage_modifiable": "0" },
            { "trading_cooldown": "0" },
            { "transfer_pausable": "0" }
        ];

        let score = 0;

        if (res.status == 200) {
            const data = res.data.result[token];

            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const _key = Object.keys(key)[0]

                if (_key == "liq_locked") {
                    if (data.lp_holders) {
                        let totalHoldings = 0;

                        for (let x = 0; x < data.lp_holders.length; x++) {
                            const holder = data.lp_holders[x];
                            const eligibleHolders = ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"];

                            if (eligibleHolders.includes(holder.address.toLowerCase()) && holder.is_locked == 1) {
                                totalHoldings += parseFloat(holder.percent)
                            }
                        }

                        if (totalHoldings >= 0.95) {
                            score += 1
                        }
                    }

                } else if (["sell_tax", "buy_tax", "owner_percent", "creator_percent"].includes(_key)) {
                    score = parseFloat(data[_key]) <= parseFloat(key[_key]) ? score + 1 : score;
                } else {
                    if (data[_key] == key[_key]) {
                        score += 1
                    }
                }

            }
        }

        score = (score / keys.length) * 100;

        // log("GoPlus", `Score is ${score}`);

        return { success: score >= GOPLUS_MIN_SR ? true : false, score };
    } catch (error) {
        log("Sniper - GoPlus", error);
    }

    return { success: false, score: 0 };
};

const doQuickIntelScan = async (token) => {
    try {
        log("Sniper", "Scanning Started");

        const [goPlusResult, tokenSnifferResult] = await Promise.allSettled([
            doGoPlusScan(token),
            doTokenSnifferScan(token)
        ]);

        const scores = `Scores: ${ goPlusResult.value.score } | ${ tokenSnifferResult.value.score }`
        const success = (goPlusResult.value.success && tokenSnifferResult.value.success) ? true : false;
        success ? log("Sniper", `Token is safe - ${scores}`) : log("Sniper", `Token is not safe - ${scores}`);
        log("", "")

        return { success, goPlusScore: goPlusResult.value.score, tokenSnifferScore: tokenSnifferResult.value.score };
    } catch (error) {
        log("Sniper - QuickIntel", error);
    }

    return { success: false, goPlusScore: 0, tokenSnifferScore: 0 };
};

const saveNewToken = (filename, data) => {
    let _data = JSON.parse(fs.readFileSync(filename, { encoding: "utf8" }));

    _data.push(data);

    fs.writeFileSync(filename, JSON.stringify(_data), { encoding: "utf8" });
};

(async () => {

    log("Sniper", "Starting the Bot");

    await initBrowser();

    const factoryAddress = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
    const provider = new ethers.providers.WebSocketProvider("wss://eth-mainnet.g.alchemy.com/v2/54T0kbEeD4z8JqKzZE4jjKt2zdtSs1bg");
    const tokenContract = new ethers.Contract(factoryAddress, ABI, provider);

    log("Sniper", "Listenings to Events");
    log("", "");
    tokenContract.on("PairCreated", async (token0, token1, pair, noname, tx) => {
        const txData = await provider.getTransaction(tx.transactionHash);

        if (txData.data == "0xc9567bf9" || txData.data == "0x02ac8168") {
            const token = token1.toLowerCase().endsWith("83c756cc2") ? token0.toLowerCase() : token1.toLowerCase();

            log("Sniper", "PairCreated: " + token);

            const { success, goPlusScore, tokenSnifferScore } = await doQuickIntelScan(token);

            saveNewToken("tokens.json", { success, token, goPlusScore, tokenSnifferScore });
        };
    });
})();


// initBrowser().then(async () => { const result = await doQuickIntelScan("0x32f12ba278b75179397b1b63ab2a6a3904da498e"); console.log(result) });
