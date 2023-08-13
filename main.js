const fs = require("fs");
const ethers = require("ethers");
const web3 = require("web3");
const axios = require("axios").default;
const { FlashbotsBundleProvider } = require("@flashbots/ethers-provider-bundle");
const { log, sleep, saveNewToken } = require("./utils/utils");

const FACTORY_ABI = require("./factoryABI.json");
const ROUTER_ABI = require("./routerABI.json");

const FACTORY_ADDR = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH_ADDR = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const GOPLUS_MIN_VP = 80; // 80%
const GOPLUS_MIN_SR = 85; // 85%

const MAX_GAS_FEES = 30 * (10 ** 9); // 30 Gwei
const EXTRA_GAS_FEES = 0 // 3 * (10 ** 9); // 3 Gwei

const MAX_TAX = 10; // 10%
const BUDGET = 10; // 50 USD

const ELIGBL_HOLDERS = [
    "0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dead",
    "0x663a5c229c09b049e36dcc11a9b0d4a8eb9db214"
];

const abiCoder = ethers.utils.defaultAbiCoder;
const etherScanProvider = new ethers.providers.EtherscanProvider({ name: "homestead", chainId: 1 }, "VI19J433TAWE9DCDFI5J1FENQQDU6TW35X");


const fetchTokenFromGoPlus = async (token) => {
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

                if (res.data.result[token].buy_tax.length !== 0 || x >= 5) {
                    break;
                }

                await sleep(2);

                x += 1;

            } catch (error) {

            };
        };

        return res;

    } catch (error) {
        log("Sniper - GoPlus", error);
    }

    return { status: 500 };
}

const doGoPlusScan = async (token) => {
    try {

        const res = await fetchTokenFromGoPlus(token);
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
        const goPlusResult = await doGoPlusScan(token);

        let result = {
            success: (goPlusResult.success && isHoneyPotResult.success) ? true : false,
            data: {
                honeypot: { success: isHoneyPotResult.success, ...isHoneyPotResult.data },
                goplus: { ...goPlusResult }
            }
        };

        if (result.success) {
            let waitTime = 0;

            while (true) {
                const res = await fetchTokenFromGoPlus(token);

                if (res.status == 200) {
                    const data = res.data.result[token];

                    if (ELIGBL_HOLDERS.includes(data.owner_address)) {
                        if (parseFloat(data.creator_percent) <= 0.05) {
                            if (data.lp_holders) {
                                let totalHoldings = 0;

                                for (let x = 0; x < data.lp_holders.length; x++) {
                                    const holder = data.lp_holders[x];

                                    if (holder.is_locked == 1) {
                                        totalHoldings += parseFloat(holder.percent);
                                    }
                                }

                                if (totalHoldings >= 0.95) {
                                    break;
                                }
                            }
                        }
                    }
                }

                if (waitTime >= 600) {
                    result = { success: false, data: {} };
                    break;
                }

                await sleep(5);
                waitTime += 5
            }
        }

        return result;

    } catch (error) {
        log("Sniper - isTokenSafe", error);
    };

    return { success: false, data: {} };
};

const createBuyTxAndSend = async (token, provider, wallet, routerContract, flashbotsProvider, gas, maxBuyAmountInETH) => {
    try {
        let value = 0;
        let gasLimit = 400000;
        const gasPrice = parseInt((await provider.getGasPrice()).toString()) + EXTRA_GAS_FEES;

        if (gasPrice > MAX_GAS_FEES) {
            return { success: false, reason: "Gas price is too high!" };
        };

        const ethPrice = await etherScanProvider.getEtherPrice();
        const budget = BUDGET / ethPrice;

        if (maxBuyAmountInETH) {

            if (budget > maxBuyAmountInETH) {
                value = maxBuyAmountInETH;
            } else {
                value = budget;
            };

        } else {
            value = budget;
        };

        if (gas) {
            if (parseInt(gas) > 400000) {
                gasLimit = parseInt(gas);
            };
        };

        // const amountIn = web3.utils.toWei(value, "ether");
        const path = [WETH_ADDR, token];
        // const amounts = await routerContract.methods.getAmountsOut(amountIn, path).call();
        // const amountOutMin = parseInt(ethers.BigNumber.from(amounts[1]).toString()) * 0.95; // Expect 95% of expected
        // let amountOutMinWithSlippage = (amountOutMin * 0.60).toFixed(0); // 40% Slippage

        // console.log(amountOutMinWithSlippage)

        // if (amountOutMinWithSlippage.length > 18) {
        //     amountOutMinWithSlippage = (parseInt(amountOutMinWithSlippage) / (10 ** 18)).toFixed(0);
        // } else {
        //     amountOutMinWithSlippage = (parseInt(amountOutMinWithSlippage) / (10 ** 9)).toFixed(0);
        // }

        // console.log(amountOutMinWithSlippage);
        const amountOutMinWithSlippage = "0";

        const data = abiCoder.encode(['uint256', 'address[]', 'address', 'uint256'],
            [
                amountOutMinWithSlippage,
                path,
                wallet.address,
                ((new Date().getTime() / 1000) + (30 * 60)).toFixed(0)
            ]
        );

        value = ethers.utils.parseEther(value.toFixed(6));
        const input = `0xb6f9de95${data.slice(2)}`;
        const nonce = await provider.getTransactionCount(wallet.address);
        const finalTx = {};

        finalTx["from"] = wallet.address;
        finalTx["to"] = ROUTER_ADDR;
        finalTx["nonce"] = nonce;
        finalTx["gasLimit"] = gasLimit;
        finalTx["gasPrice"] = gasPrice;
        finalTx["data"] = input;
        finalTx["value"] = value;

        const signedTx = await wallet.signTransaction(finalTx);
        const txRes = await provider.sendTransaction(signedTx);

        log("Sniper", `Sent Buy Transaction - Token: ${token} - Tx: https://etherscan.io/tx/${txRes.hash}`);

        return { success: true, receipt: txRes };

    } catch (error) {
        log("Sniper - TX - Error", "");
        console.trace(error);
    }

    return { success: false, reason: "An error occoured!" };
}

const handleNewToken = async (token0, token1, txHash, provider, creationMethods, routerContract, wallet, flashbotsProvider) => {
    const { data } = await provider.getTransaction(txHash);

    if (creationMethods.includes(data)) {
        const token = token1.toLowerCase().endsWith("83c756cc2") ? token0.toLowerCase() : token1.toLowerCase();

        log("Sniper", "PairCreated: " + token);

        await sleep(30); // Wait for the token to sync on the EVM

        const { success, data } = await isTokenSafe(token);
        const time = new Date().toLocaleString();

        console.log(`[${time}] [${token}] [${success}]`, data);

        if (success) {
            const result = await createBuyTxAndSend(token, provider, wallet, routerContract, flashbotsProvider, data.honeypot.buyGas, data.honeypot.maxBuy);
            if (success) {

            }
        }


        saveNewToken(`token.json`, { time, token, ...data });
    };
};

(async () => {
    log("Sniper", "Starting the Bot");

    const provider = new ethers.providers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/FQtGVKbgl4O-HeVlqKBnC-QGxsH4SKMh");
    // const _provider = new web3.Web3("https://eth-mainnet.g.alchemy.com/v2/FQtGVKbgl4O-HeVlqKBnC-QGxsH4SKMh",);
    const factoryContract = new web3.Contract(FACTORY_ABI, FACTORY_ADDR);
    const routerContract = new web3.Contract(ROUTER_ABI, ROUTER_ADDR);

    routerContract.setProvider("https://eth-mainnet.g.alchemy.com/v2/FQtGVKbgl4O-HeVlqKBnC-QGxsH4SKMh");
    factoryContract.setProvider("wss://eth-mainnet.g.alchemy.com/v2/54T0kbEeD4z8JqKzZE4jjKt2zdtSs1bg");

    const creationMethods = ["0xc9567bf9", "0x02ac8168", "0x01339c21"];
    const authSigner = new ethers.Wallet("4e4eafcb6e2c392f0559909f554cf943d4bcfd5fdc091c7c5b4369436cb3ecb1", provider);
    const wallet = new ethers.Wallet("2327a64986acea02d85e34e13e6bbc46e3f13f92f10cd3e2858aa14ee16c5b43", provider);
    const flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner);

    log("Sniper", "Listenings to Events");
    log("", "");

    const token = "0x175fE43259fBC8F0Ae3e3E7E70cCd53e292706FC".toLowerCase();
    await createBuyTxAndSend(token, provider, wallet, routerContract, flashbotsProvider, 234467, undefined);

    // console.log(5.40800e15 == 5408000000000000)

    // const data = "0xb6f9de9500000000000000000000000000000000000000000000001a852d000b34b900000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000c366ebb04e251b0f8bc46468639e9008da8e9c570000000000000000000000000000000000000000000000000000000064d8e60d0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000175fe43259fbc8f0ae3e3e7e70ccd53e292706fc"

    // const d = abiCoder.decode(['uint256', 'address[]', 'address', 'uint256'], ethers.utils.hexDataSlice(data, 4));
    // console.log(d[0].toNumber())

    // const events = factoryContract.events.allEvents();
    // events.on('data', (event) => {
    //     handleNewToken(event.returnValues.token0, event.returnValues.token1, event.transactionHash, provider, creationMethods, routerContract, wallet, flashbotsProvider);
    // });

})();

// const token = "0x05246f3e83fee4a7fdd20050f80a3af032a49f7b";
// doIsHoneyPotScan(token).then(async (data) => {
//     console.log(data);

//     const d = await doGoPlusScan(token);
//     console.log(d);
// });

// isTokenSafe("0x84533168ed633266397f565f433339a9c703394c").then((d) => { console.log(d) });

// doGoPlusScan("0xc922edf376db7542846f91c94436ed479131f627").then((d) => { console.log(d) });
