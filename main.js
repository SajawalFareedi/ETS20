const fs = require("fs");
const ethers = require("ethers");
const axios = require("axios").default;
const puppeteer = require("puppeteer-extra").default;
puppeteer.use(require("puppeteer-extra-plugin-stealth")());
const { log, sleep, saveNewToken } = require("./utils/utils");

const ABI = require("./factoryABI.json");
const GOPLUS_MIN_SR = 80;
const MAX_TAX = 10


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
        const keys = JSON.parse(fs.readFileSync("keys.json", { encoding: "utf8" }));

        let score = 0;
        let vip_points = 0;

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
                            // const eligibleHolders = [
                            //     "0x0000000000000000000000000000000000000000",
                            //     "0x000000000000000000000000000000000000dead",
                            //     "0x663a5c229c09b049e36dcc11a9b0d4a8eb9db214"
                            // ];

                            // eligibleHolders.includes(holder.address.toLowerCase()) && 

                            if (holder.is_locked == 1) {
                                totalHoldings += parseFloat(holder.percent);
                            }
                        }

                        if (totalHoldings >= 0.95) {
                            vip_points += 1
                        }
                    }

                } else if (["sell_tax", "buy_tax", "owner_percent", "creator_percent"].includes(_key)) {
                    vip_points = parseFloat(data[_key]) <= parseFloat(key[_key]) ? vip_points + 1 : vip_points;
                } else {
                    if (data[_key] == key[_key]) {
                        score += 1
                    }
                }
            }
        }

        score = (score / (keys.length - 5)) * 100;
        vip_score = (vip_points / 5) * 100

        return { success: (score >= GOPLUS_MIN_SR && vip_score >= GOPLUS_MIN_SR) ? true : false, score, vip_score };

    } catch (error) {
        log("Sniper - GoPlus", error);
    }

    return { success: false, score: 0, vip_score: 0 };
};

const doIsHoneyPotScan = async (token) => {
    try {
        const headers = {
            authority: "api.honeypot.is",
            Accept: "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            Dnt: "1",
            Referer: "https://honeypot.is/",
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

        let data;

        while (true) {
            try {
                const res = await axios.get(`https://api.honeypot.is/v2/IsHoneypot?address=${token}&chainID=1`, { headers: headers });

                if (res.status == 200) {
                    data = res.data;
                    break;
                }
            } catch (error) { };
        };

        if (data.simulationSuccess) {
            const isHoneypot = data.honeypotResult.isHoneypot;
            const buyTax = data.simulationResult.buyTax;
            const sellTax = data.simulationResult.sellTax;
            const transferTax = data.simulationResult.transferTax;
            const maxBuy = data.simulationResult?.maxBuy?.withToken;
            const buyGas = parseInt(data.simulationResult.buyGas);

            if (!isHoneypot && buyTax <= MAX_TAX && sellTax <= MAX_TAX && transferTax <= MAX_TAX) {
                return { success: true, data: { maxBuy: maxBuy ? maxBuy.toFixed(3) : 0, buyGas } };
            };
        };

    } catch (error) {
        log("Sniper - HoneyPot", error);
    };

    return { success: false };
};

const isTokenSafe = async (token) => {
    try {
        log("Sniper", "Scanning Started");

        const [goPlusResult, isHoneyPotResult] = await Promise.allSettled([
            doGoPlusScan(token),
            doIsHoneyPotScan(token)
        ]);

        if (goPlusResult.status == "fulfilled" && isHoneyPotResult.status == "fulfilled") {
            return { success: (goPlusResult.value.success && isHoneyPotResult.value.success) ? true : false, data: { ...isHoneyPotResult.value.data, ...goPlusResult.value } };
        };

    } catch (error) {
        log("Sniper - isTokenSafe", error);
    };

    return { success: false };
};

(async () => {
    log("Sniper", "Starting the Bot");

    const factoryAddress = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
    const provider = new ethers.providers.WebSocketProvider("wss://eth-mainnet.g.alchemy.com/v2/54T0kbEeD4z8JqKzZE4jjKt2zdtSs1bg");
    const tokenContract = new ethers.Contract(factoryAddress, ABI, provider);

    log("Sniper", "Listenings to Events");
    log("", "");

    let buy = true;
    tokenContract.on("PairCreated", async (token0, token1, pair, noname, tx) => {
        const txData = await provider.getTransaction(tx.transactionHash);

        if (txData.data == "0xc9567bf9" || txData.data == "0x02ac8168") {
            const token = token1.toLowerCase().endsWith("83c756cc2") ? token0.toLowerCase() : token1.toLowerCase();

            if (buy) {
                // buy = false;
                log("Sniper", "PairCreated: " + token);

                await sleep(5);
                const { success, data } = await isTokenSafe(token);

                const time = new Date().toLocaleString();

                saveNewToken(`token.json`, { time, success, data });

                // if (success) {
                //     data
                // } else {
                //     buy = true;
                // };
            }
        };
    });
})();

const token = "0x09be0b9278abd1b10cebbd3dacb55dc39fc23aa3";

// doIsHoneyPotScan(token).then(async (data) => {
//     console.log(data);

//     const d = await doGoPlusScan(token);
//     console.log(d);
// });

// isTokenSafe(token).then((d) => { console.log(d) });

