const fs = require("fs");
const ethers = require("ethers");
const web3 = require("web3");
const axios = require("axios").default;
const prompt = require("prompt-sync")({ sigint: true });
const { log, sleep, saveNewToken } = require("./utils/utils");

const FACTORY_ABI = require("./ABIs/factoryABI.json");
const ROUTER_ABI = require("./ABIs/routerABI.json");
const PAIR_ABI = require("./ABIs/pairABI.json");
const ERC20_ABI = require("./ABIs/erc20ABI.json");

const FACTORY_ADDR = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH_ADDR = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const GOPLUS_MIN_VP = 80; // 80%
const GOPLUS_MIN_SR = 85; // 85%

const MAX_GAS_FEES = 30 * (10 ** 9); // 30 Gwei
const EXTRA_GAS_FEES = 3 * (10 ** 9); // 3 Gwei
const GAS_LIMIT = 500000;
const APPROVE_GAS_LIMIT = 150000;

const DEADLINE = 10; // 10 minutes
const MAX_TAX = 10; // 10%
const BUDGET = 50; // 50 USD

const MIN_USD_BALANCE = 90;
const MIN_USD_BALANCE_SELL_GAS = 25;
const MIN_PROFIT = 0.5; // 50%

const APPROVED_TOKEN_AMOUNT = '115792089237316195423570985008687907853269984665640564039457584007913129639935'; // (2^256 - 1 )

const MAX_HOLDER_PERCENT = 0.02; // 2%
const ELIGBL_HOLDERS = [
    "0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dead",
    "0x663a5c229c09b049e36dcc11a9b0d4a8eb9db214"
];

let BUYING_ENABLED = true;
let ONLY_ONE = false;

const abiCoder = ethers.utils.defaultAbiCoder;
const etherScanProvider = new ethers.providers.EtherscanProvider({ name: "homestead", chainId: 1 }, "VI19J433TAWE9DCDFI5J1FENQQDU6TW35X");

const provider = new ethers.providers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/FQtGVKbgl4O-HeVlqKBnC-QGxsH4SKMh");

const factoryContract = new web3.Contract(FACTORY_ABI, FACTORY_ADDR);
const routerContract = new web3.Contract(ROUTER_ABI, ROUTER_ADDR);

routerContract.setProvider("https://eth-mainnet.g.alchemy.com/v2/FQtGVKbgl4O-HeVlqKBnC-QGxsH4SKMh");
factoryContract.setProvider("wss://eth-mainnet.g.alchemy.com/v2/54T0kbEeD4z8JqKzZE4jjKt2zdtSs1bg");

const creationMethods = ["0xc9567bf9", "0x02ac8168", "0x01339c21"];
const wallet = new ethers.Wallet("2327a64986acea02d85e34e13e6bbc46e3f13f92f10cd3e2858aa14ee16c5b43", provider);


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

                    if (parseFloat(data[_key]) <= MAX_HOLDER_PERCENT) {
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
            const decimals = data.token.decimals;

            if (!isHoneypot && buyTax <= MAX_TAX && sellTax <= MAX_TAX && transferTax <= MAX_TAX) {
                return { success: true, data: { maxBuy: maxBuy ? parseFloat(maxBuy.toFixed(3)) : 0, buyGas, decimals } };
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
        // log("Sniper", "Scanning Started");

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
                        if (parseFloat(data.creator_percent) <= MAX_HOLDER_PERCENT) {
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

const approve = async (token, tokenContract) => {
    try {

        const gasPrice = parseInt((await provider.getGasPrice()).toString());
        const nonce = await provider.getTransactionCount(wallet.address);

        const txParams = {
            to: token,
            from: wallet.address,
            nonce: nonce,
            gasLimit: APPROVE_GAS_LIMIT,
            gasPrice: gasPrice,
            data: tokenContract.methods.approve(ROUTER_ADDR, APPROVED_TOKEN_AMOUNT).encodeABI(),
        }

        const sTx = await wallet.signTransaction(txParams);
        const txRes = await provider.sendTransaction(sTx);

        log("Sniper", `Sent Approve Transaction - Token: ${token} - Tx: https://etherscan.io/tx/${txRes.hash}`);

        const receipt = await txRes.wait();

        if (receipt.status == 1) {
            log("Sniper", `Approve Transaction Successful - Token: ${token} - Tx: https://etherscan.io/tx/${txRes.hash}`);
        } else {
            log("Sniper", `Approve Transaction Failed - Tx: https://etherscan.io/tx/${txRes.hash}`);

            while (true) {
                const input = prompt("Not able to approve the token! Please approve manually and type Y: ");

                if (input == "Y" || input == "y") {
                    break;
                };
            };
        };

    } catch (error) {
        log("Sniper - ATX - Error", "");
        console.trace(error);

        while (true) {
            const input = prompt("Not able to approve the token! Please approve manually and type Y: ");

            if (input == "Y" || input == "y") {
                break;
            };
        };
    };

    return;

};

const createBuyTxAndSend = async (token, gas, maxBuyAmountInETH) => {
    try {
        /*
        * TODO: Use while loop and try to Buy the token, if it fails due to low balance or gasPrice, then should be done manually. 
        */
        if (BUYING_ENABLED) {
            let value = 0;
            let gasLimit = GAS_LIMIT;
            const gasPrice = parseInt((await provider.getGasPrice()).toString()) + EXTRA_GAS_FEES;

            if (gasPrice > MAX_GAS_FEES) {
                return { success: false, reason: `Failed to Buy Token because of High Gas Price! GasPrice: ${gasPrice}` };
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
                if (parseInt(gas) > GAS_LIMIT) {
                    gasLimit = parseInt(gas);
                };
            };

            const amountIn = web3.utils.toWei(value, "ether");
            const path = [WETH_ADDR, token];
            const amounts = await routerContract.methods.getAmountsOut(amountIn, path).call();
            const expectedBuyingPrice = (parseInt(ethers.BigNumber.from(amounts[0]).toString()) / parseInt(ethers.BigNumber.from(amounts[1]).toString())) * ethPrice;

            const amountOutMinWithSlippage = "0";

            const data = abiCoder.encode(['uint256', 'address[]', 'address', 'uint256'],
                [
                    amountOutMinWithSlippage,
                    path,
                    wallet.address,
                    ((new Date().getTime() / 1000) + (DEADLINE * 60)).toFixed(0)
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

            const walletBalance = await wallet.getBalance();
            const ethAvailable = parseInt((walletBalance.toString())) / (10 ** 18);
            const usdAvailable = ethAvailable * ethPrice;

            if (usdAvailable >= MIN_USD_BALANCE) {
                if (BUYING_ENABLED) {
                    const signedTx = await wallet.signTransaction(finalTx);
                    const txRes = await provider.sendTransaction(signedTx);

                    log("Sniper", `Sent Buy Transaction - Token: ${token} - Tx: https://etherscan.io/tx/${txRes.hash}`);

                    return { success: true, receipt: txRes, price: expectedBuyingPrice };
                };
            } else {
                return { success: false, reason: "Balance is low!" };
            };
        };

        return { success: false, reason: "Buying is disabled!" };

    } catch (error) {
        log("Sniper - BTX - Error", "");
        console.trace(error);
    }

    return { success: false };
};

const sellCronStart = async (tx, token, buyingPrice, pairAddr, decimals) => {
    try {

        let receipt;
        try {

            receipt = await tx.wait();
            if (receipt.status == 0) {
                log("Sniper", `Buy Transaction Failed - Token: ${token} - Tx: https://etherscan.io/tx/${receipt.hash}`);
                return;
            };

        } catch (e) {
            log("Sniper", `Buy Transaction Failed - Token: ${token} - Tx: https://etherscan.io/tx/${receipt.hash}`);
            return;
        };

        const time = new Date().toLocaleString();
        saveNewToken("tokenBought.json", { time, token, hash: receipt.hash, buyingPrice });

        const pairContract = new web3.Contract(PAIR_ABI, pairAddr);
        pairContract.setProvider("https://eth-mainnet.g.alchemy.com/v2/FQtGVKbgl4O-HeVlqKBnC-QGxsH4SKMh");

        const tokenContract = new web3.Contract(ERC20_ABI, token);
        tokenContract.setProvider("https://eth-mainnet.g.alchemy.com/v2/FQtGVKbgl4O-HeVlqKBnC-QGxsH4SKMh");

        await approve(token, tokenContract);

        let ATTS = 1;
        // let startTokenBalance = 0

        while (true) {
            const ethPrice = await etherScanProvider.getEtherPrice();
            const reserves = await pairContract.methods.getReserves().call();

            const reserve0 = Number(reserves._reserve0);
            const reserve1 = Number(reserves._reserve1);

            let tokenReserve;
            let wethReserve;

            if (decimals < 18) {
                // decimals < 18 ? reserve1 / (10 ** decimals) : reserve0 / (10 ** decimals);
                tokenReserve = reserve0 < reserve1 ? reserve0 / (10 ** decimals) : reserve1 / (10 ** decimals);
                // decimals < 18 ? reserve0 / (10 ** 18) : reserve1 / (10 ** 18);
                wethReserve = reserve0 < reserve1 ? reserve1 / (10 ** 18) : reserve0 / (10 ** 18);
            } else {
                tokenReserve = reserve0 < reserve1 ? reserve1 / (10 ** decimals) : reserve0 / (10 ** decimals);
                wethReserve = reserve0 < reserve1 ? reserve0 / (10 ** 18) : reserve1 / (10 ** 18);
            }
            
            const currentPrice = (wethReserve / tokenReserve) * ethPrice;

            if (wethReserve < 0.1) {
                break;
            };

            const priceDifferenceInPercentage = ((currentPrice - parseFloat(buyingPrice)) / parseFloat(buyingPrice)) * 100;

            if (priceDifferenceInPercentage >= ((MIN_PROFIT * 100) * ATTS)) {
                let tokenBalance = await tokenContract.methods.balanceOf(wallet.address).call();
                tokenBalance = parseInt((tokenBalance).toString()) / (10 ** decimals);

                // if (ATTS == 1) {
                //     startTokenBalance = tokenBalance;
                // }

                // const currentTokenBalancePercentage = Math.round((tokenBalance / startTokenBalance) * 100);
                const tokenBalanceWorth = tokenBalance * currentPrice;

                if (tokenBalanceWorth <= 5) {
                    break;
                }

                const amountIn = ((tokenBalance * MIN_PROFIT) * (10 ** decimals)).toString();
                /*
                * TODO: Calculate the proper amountOutMin because putting 0 is way more riskier.
                * You may won't really receive anything. 
                */
                const amountOutMinWithSlippage = "0";
                const path = [token, WETH_ADDR];

                const data = abiCoder.encode(['uint256', 'uint256', 'address[]', 'address', 'uint256'],
                    [
                        amountIn,
                        amountOutMinWithSlippage,
                        path,
                        wallet.address,
                        ((new Date().getTime() / 1000) + (DEADLINE * 60)).toFixed(0)
                    ]
                );

                const input = `0x791ac947${data.slice(2)}`;
                const nonce = await provider.getTransactionCount(wallet.address);
                const gasPrice = parseInt((await provider.getGasPrice()).toString()) + EXTRA_GAS_FEES;
                const finalTx = {};

                finalTx["from"] = wallet.address;
                finalTx["to"] = ROUTER_ADDR;
                finalTx["nonce"] = nonce;
                finalTx["gasLimit"] = GAS_LIMIT;
                finalTx["gasPrice"] = gasPrice;
                finalTx["data"] = input;

                const walletBalance = await wallet.getBalance();
                const ethAvailable = parseInt((walletBalance.toString())) / (10 ** 18);
                const usdAvailable = ethAvailable * ethPrice;

                if (usdAvailable >= MIN_USD_BALANCE_SELL_GAS) {
                    try {

                        const signedTx = await wallet.signTransaction(finalTx);
                        const txRes = await provider.sendTransaction(signedTx);

                        log("Sniper", `Sent Sell Transaction - Token: ${token} - Tx: https://etherscan.io/tx/${txRes.hash}`);

                        const receipt = await txRes.wait();

                        if (receipt.status == 1) {
                            log("Sniper", `Sell Transaction Successful - Token: ${token} - Tx: https://etherscan.io/tx/${txRes.hash}`);
                            ATTS += 1;
                        } else {
                            log("Sniper", `Sell Transaction Failed - Tx: https://etherscan.io/tx/${txRes.hash}`);

                            while (true) {
                                const input = prompt("Not able to sell the token! Please sell manually and type Y: ");

                                if (input == "Y" || input == "y") {
                                    ATTS += 1;
                                    break;
                                };
                            };
                        };

                    } catch (error) {
                        log("Sniper - Sell Error", "");
                        console.trace(error);

                        while (true) {
                            const input = prompt("Not able to sell the token! Please sell manually and type Y: ");

                            if (input == "Y" || input == "y") {
                                ATTS += 1;
                                break;
                            };
                        };
                    };

                } else {
                    log("Sniper", `======================================== Balance is low! Can't Sellllll! ==================================`);

                    while (true) {
                        const input = prompt("Please put some ETH manually and type Y: ");

                        if (input == "Y" || input == "y") {
                            break;
                        };
                    };
                };
            };
        };

        BUYING_ENABLED = true;
        return;

    } catch (error) {
        log("Sniper - STX - Error", "");
        console.trace(error);

        while (true) {
            const input = prompt("Not able to sell the token! Please sell manually and type Y: ");

            if (input == "Y" || input == "y") {
                BUYING_ENABLED = true;
                break;
            };
        };
    }

    return;
};

const handleNewToken = async (token0, token1, txHash, pairAddr) => {
    if (BUYING_ENABLED && !ONLY_ONE) {
        // ONLY_ONE = true;
        const { data } = await provider.getTransaction(txHash);

        if (creationMethods.includes(data)) {
            const token = token1.toLowerCase().endsWith("83c756cc2") ? token0.toLowerCase() : token1.toLowerCase();

            log("Sniper", "PairCreated: " + token);

            await sleep(30); // Wait for the token to sync on the EVM

            const { success, data } = await isTokenSafe(token);
            const time = new Date().toLocaleString();

            if (success) {
                console.log(`[${time}] [https://dexscreener.com/ethereum/${token}] [${success}]`, data);

                const result = await createBuyTxAndSend(token, data.honeypot.buyGas, data.honeypot.maxBuy);
                if (result.success) {
                    BUYING_ENABLED = false;
                    sellCronStart(result.receipt, token, result.price, pairAddr, data.honeypot.decimals);
                } else {
                    if (result.reason) { log("Sniper", result.reason) };
                };

            };
        };
    };
};

(async () => {
    log("Sniper", "Listenings to Events");
    log("", "");

    // const pairAddr = "0x7ef0dC73D9807C491C7A34f502f3af8626322f9B".toLowerCase();
    // const token = "0xeAf20a9C529F0dA7943558e66a46A684f7A64245".toLowerCase();

    // const pairAddr = "0x931CCb5B70fe54BeBF36b4d5BB80D17B2c7f80D2".toLowerCase();
    // const token = "0x1441ba039f71a6b942a77829d0d1784fb9b771bc".toLowerCase();

    // const pairAddr = "0x606EEf5677C104bEaE943bb2F9758113e06f34dB".toLowerCase();
    // const token = "0x175fE43259fBC8F0Ae3e3E7E70cCd53e292706FC".toLowerCase();
    // await sellCronStart("", token, 0.0000015, pairAddr, 9);

    const events = factoryContract.events.allEvents();
    events.on('data', (event) => {
        handleNewToken(event.returnValues.token0, event.returnValues.token1, event.transactionHash, event.returnValues.pair);
    });

})();
