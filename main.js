const fs = require("fs");
const ethers = require("ethers");
const axios = require("axios").default;
const { log, sleep, saveNewToken } = require("./utils/utils");

const ABI = require("./factoryABI.json");
const GOPLUS_MIN_VP = 80;
const GOPLUS_MIN_SR = 85;
const MAX_TAX = 10


const doGoPlusScan = async (token, notHoneypot) => {
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

        let res;
        let x = 0;

        while (true) {
            try {
                res = await axios.get(`https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses=${token}`, { headers: headers });

                if (res.data.result[token].buy_tax.length !== 0 || x >= 3) {
                    break;
                }

                await sleep(1);

                x += 1;
            } catch (error) {

            }
        }

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

                } else if (["sell_tax", "buy_tax"].includes(_key)) {

                    if (parseFloat(data[_key]) <= 0.1) {
                        vip_points += 1
                    }

                } else if (["owner_percent", "creator_percent"].includes(_key)) {

                    if (parseFloat(data[_key]) <= 0.05) {
                        vip_points += 1
                    }
                    
                } else if (_key === "slippage_modifiable") {

                    if (data[_key] === "0") {
                        vip_points += 1
                    }

                } else {

                    if (String(data[_key]) === String(key[_key])) {
                        score += 1
                    }
                }
            }
        }

        score = (score / (keys.length - 6)) * 100;
        vip_score = (vip_points / 6) * 100;

        // if (notHoneypot && vip_score < 40) {
        //     return await doGoPlusScan(token, notHoneypot);
        // }

        return { success: (score >= GOPLUS_MIN_SR && vip_score >= GOPLUS_MIN_VP) ? true : false, score: parseInt(score), vip_score: parseInt(vip_score) };

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
        let x = 0

        while (true) {
            try {
                const res = await axios.get(`https://api.honeypot.is/v2/IsHoneypot?address=${token}&chainID=1`, { headers: headers });

                if (res.status == 200 && res.data.simulationSuccess) {
                    data = res.data;
                    break;
                }

                if (x >= 10) {
                    break;
                }

                x += 1

            } catch (error) { };
        };

        if (data) {
            const isHoneypot = data.honeypotResult.isHoneypot;
            const buyTax = data.simulationResult.buyTax;
            const sellTax = data.simulationResult.sellTax;
            const transferTax = data.simulationResult.transferTax;
            const maxBuy = data.simulationResult?.maxBuy?.withToken;
            const buyGas = parseInt(data.simulationResult.buyGas);

            if (!isHoneypot && buyTax <= MAX_TAX && sellTax <= MAX_TAX && transferTax <= MAX_TAX) {
                return { success: true, data: { maxBuy: maxBuy ? parseFloat(maxBuy.toFixed(3)) : 0, buyGas } };
            };

            return { success: false, status: "taxes are high!" };
        }

    } catch (error) {
        log("Sniper - HoneyPot", error);
    };

    return { success: false };
};

const isTokenSafe = async (token) => {
    try {
        log("Sniper", "Scanning Started");

        const isHoneyPotResult = await doIsHoneyPotScan(token);
        const goPlusResult = await doGoPlusScan(token, isHoneyPotResult.success);

        return { success: (goPlusResult.success && isHoneyPotResult.success) ? true : false, data: { honeypot: { success: isHoneyPotResult.success, ...isHoneyPotResult.data }, goplus: { ...goPlusResult } } };

    } catch (error) {
        log("Sniper - isTokenSafe", error);
    };

    return { success: false, data: {} };
};

const handleNewToken = async (token0, token1, tx, provider, creationMethods, tokenContract) => {
    const { data } = await provider.getTransaction(tx.transactionHash);

    if (creationMethods.includes(data)) {
        const token = token1.toLowerCase().endsWith("83c756cc2") ? token0.toLowerCase() : token1.toLowerCase();

        log("Sniper", "PairCreated: " + token);

        await sleep(5);
        const { success, data } = await isTokenSafe(token);

        console.log(token, data);

        const time = new Date().toLocaleString();
        saveNewToken(`token.json`, { time, token, ...data });
    };
};

(async () => {
    log("Sniper", "Starting the Bot");

    const factoryAddress = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
    const provider = new ethers.providers.WebSocketProvider("wss://eth-mainnet.g.alchemy.com/v2/54T0kbEeD4z8JqKzZE4jjKt2zdtSs1bg");
    const tokenContract = new ethers.Contract(factoryAddress, ABI, provider);
    const creationMethods = ["0xc9567bf9", "0x02ac8168"]

    log("Sniper", "Listenings to Events");
    log("", "");

    tokenContract.on("PairCreated", (token0, token1, pair, noname, tx) => {
        handleNewToken(token0, token1, tx, provider, creationMethods, tokenContract);
    });
})();

// const token = "0x05246f3e83fee4a7fdd20050f80a3af032a49f7b";
// doIsHoneyPotScan(token).then(async (data) => {
//     console.log(data);

//     const d = await doGoPlusScan(token);
//     console.log(d);
// });

// isTokenSafe(token).then((d) => { console.log(d) });

// doGoPlusScan("0xc922edf376db7542846f91c94436ed479131f627").then((d) => { console.log(d) });
