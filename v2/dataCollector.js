// const ethers = require("ethers");
// const web3 = require("web3");
const axios = require("axios").default;
const { log, saveNewToken } = require("../utils/utils");
const fs = require("fs");

// const FACTORY_ABI = require("../ABIs/factoryABI.json");
// const FACTORY_ADDR = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";

// const provider = new ethers.providers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/FQtGVKbgl4O-HeVlqKBnC-QGxsH4SKMh");
// const factoryContract = new web3.Contract(FACTORY_ABI, FACTORY_ADDR);

// factoryContract.setProvider("wss://eth-mainnet.g.alchemy.com/v2/54T0kbEeD4z8JqKzZE4jjKt2zdtSs1bg");
// const tradingMethods = ["0xc9567bf9", "0x02ac8168", "0x01339c21"];
// const creationMethods = ["0x60806040", "0x60c06040", "0x60656001", "0x60a06040"];


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

        try {
            const res = await axios.get(`https://api.honeypot.is/v2/IsHoneypot?address=${token}&chainID=1`, { headers: headers });

            if (res.status == 200) {
                data = res.data;
            };

        } catch (error) {
            console.log(error);
        };

        if (data) {
            const isHoneypot = (typeof data?.honeypotResult?.isHoneypot !== undefined) ? data.honeypotResult.isHoneypot : true;
            const buyTax = data?.simulationResult?.buyTax;
            const sellTax = data?.simulationResult?.sellTax;
            const transferTax = data?.simulationResult?.transferTax;
            const maxBuy = data.simulationResult?.maxBuy?.withToken;
            const buyGas = parseInt(data?.simulationResult?.buyGas);
            const decimals = data.token.decimals;


            return { success: !isHoneypot, isHoneypot: isHoneypot, buyTax, sellTax, transferTax, maxBuy: maxBuy ? parseFloat(maxBuy.toFixed(3)) : 0, buyGas, decimals };
        }

    } catch (error) {
        log("Sniper - HoneyPot", error);
    };

    return { success: false };
};

const getTokenPumpXs = async (pair) => {
    try {
        const url = `https://api.dexview.com/pair/extra-info?chainId=1&address=${pair}`;
        const headers = {
            authority: "api.dexview.com",
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            Cookie: "_pk_id.4.b299=14f1a821191e62eb.1689915617.; cf_clearance=uH1vrhJOP672rv0A3q5ElBnekKaJRPTI53aoHliqqgI-1693041392-0-1-f70b9aa7.534bf2da.727cfbd0-0.2.1693041392; _pk_ses.4.b299=1; __cf_bm=btQlX8OQecamqdwFItli1zmevdCpZexmPeWXMh_M7o0-1693042294-0-AWe+gSpUseagu2HqSsV26t84yMgWx9ZOBAO8DtyGrOkqxWoMUReQnoBv4/mv5XKI55GmVU7jQaAhAlqd1ORvTwo=",
            Dnt: "1",
            Origin: "https://www.dexview.com",
            "Sec-Ch-Ua": '"Chromium";v="116", "Not)A;Brand";v="24", "Google Chrome";v="116"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
            Secret: "5ff3a258-2700-11ed-a261-0242ac120002",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36"
        };

        let data;

        try {
            const res = await axios.get(url, { headers: headers });

            if (res.status == 200) {
                data = res.data.data;
            };

        } catch (error) {
            console.log(error);
        };

        if (data) {
            const pumpXs = data.athPriceUsd / data.listingPriceUsd;

            return { success: true, pump: parseFloat(pumpXs.toFixed(4)) };
        }

    } catch (error) {
        log("Sniper - HoneyPot", error);
    };

    return { success: false };
};

(async () => {
    const tokens = JSON.parse(fs.readFileSync("tokens.json", { encoding: "utf8" }));

    for (let i = 0; i < tokens.length; i++) {
        const { token, pair } = tokens[i];

        const isHoneyPot = await doIsHoneyPotScan(token);
        const pumpStats = await getTokenPumpXs(pair);

        const data = { token, pair, isHoneyPot: isHoneyPot.isHoneypot, pump: pumpStats.pump };

        saveNewToken("tokensPumpData.json", data);
        console.log(data);
    };

    // const pumpStats = await getTokenPumpXs("0xff5f39a26f7c082cc20ed89f6853844e8b8fc60d", "0x189F3D450342E0b5B8A7A491f3403e172d5cf26d");

    // const isHoneyPot = await doIsHoneyPotScan("0x21fecc7f914287d610882f5a0536c0a2a6c15fe3");
    // console.log(isHoneyPot);

    // const tokenContract = await provider.getLogs({ address: "0x129B689A818ccDF2102d0088208b5fc70E7093A9", fromBlock: 0, toBlock: 99999999 });

    // fs.writeFileSync("txsData.json", JSON.stringify(tokenContract), { encoding: "utf8" });

})();
