module.exports.sleep = (seconds) => {
    return new Promise((resolve) => setTimeout(() => resolve(), seconds * 1000));
};

module.exports.log = (func, msg) => {
    const time = new Date().toLocaleString();

    if (func.length == 0) {
        console.log("");
    } else {
        console.log(`[${time}] [${func}] - ${msg}`);
    }
};

module.exports.saveNewToken = (filename, data) => {
    let _data = JSON.parse(fs.readFileSync(filename, { encoding: "utf8" }));

    _data.push(data);

    fs.writeFileSync(filename, JSON.stringify(_data), { encoding: "utf8" });
};