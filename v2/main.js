const ethers = require("ethers");
const web3 = require("web3");
const { log, saveNewToken } = require("../utils/utils");

const FACTORY_ABI = require("../ABIs/factoryABI.json");
const FACTORY_ADDR = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";

const provider = new ethers.providers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/FQtGVKbgl4O-HeVlqKBnC-QGxsH4SKMh");
const factoryContract = new web3.Contract(FACTORY_ABI, FACTORY_ADDR);

factoryContract.setProvider("wss://eth-mainnet.g.alchemy.com/v2/54T0kbEeD4z8JqKzZE4jjKt2zdtSs1bg");
const tradingMethods = ["0xc9567bf9", "0x02ac8168", "0x01339c21"];
const creationMethods = ["0x60806040", "0x60c06040", "0x60656001", "0x60a06040"];


const handleNewToken = async (token0, token1, txHash, pairAddr) => {
    const t = Math.random();
    console.time(`TokenCheck ${t}`);

    const { data } = await provider.getTransaction(txHash);

    if (tradingMethods.includes(data)) {
        const token = token1.toLowerCase().endsWith("83c756cc2") ? token0.toLowerCase() : token1.toLowerCase();

        log("Sniper", `TokenCreated: https://dexscreener.com/ethereum/${token}`);

        const time = new Date().toLocaleString();
        saveNewToken("tokens.json", { time, token, pair: pairAddr });
    };

    console.timeEnd(`TokenCheck ${t}`);
    log("", "");
};

(async () => {
    log("Sniper", "Listenings to Events");
    log("", "");

    const events = factoryContract.events.allEvents();

    events.on('data', (event) => {
        handleNewToken(event.returnValues.token0, event.returnValues.token1, event.transactionHash, event.returnValues.pair);
    });

})();
