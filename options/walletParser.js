const Web3 = require('web3');
const fs = require('fs');
const ExcelJS = require('exceljs');

const {
    getAddressTokenTransaction,
    getAddressListTransaction,
    getContractAddressTransactions,
} = require('../api/etherscan');
const {getEthereumPrice, getWalletBalance, getTokenPrice} = require('../api/crypto');
const {ERC20_ABI} = require('../constants/erc2_abi');

const web3 = new Web3(`https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`);

const walletParser = async (addresses, bot, chatId) => {
    const sortAddresses = addresses.split('\n');
    const ethereumPrice = await getEthereumPrice();
    console.log(sortAddresses);
    for (const address of sortAddresses) {
        console.log('address', address)
        try {
            const addressListTransactions = await getAddressListTransaction(address);
            const walletBalance = await getWalletBalance(address);

            if (addressListTransactions.length < process.env.TRANSACTIONS_COUNT) {
                const addressTokenTransactions = await getAddressTokenTransaction(address);
                const tokenContracts = [...new Set(addressTokenTransactions.map(tx => tx.contractAddress))].slice(0.10);
                const groupedTransactions = tokenContracts.map(contractAddress => {
                    return addressTokenTransactions.filter(tx => tx.contractAddress === contractAddress);
                });

                const transactionMap = {};
                groupedTransactions.forEach(transactions => {
                    if (transactions.length > 0) {
                        transactionMap[transactions[0].contractAddress] = transactions;
                    }
                });

                let results = [];

                for (let contract of tokenContracts) {
                    try {
                        console.log(contract);
                        const contractAddressTransactions = await getContractAddressTransactions(address, contract);
                        const parseTransaction = await web3.eth.getTransactionReceipt(contractAddressTransactions[0].hash);

                        const tokenAddress = parseTransaction.logs.filter(
                            (logItem) => logItem.address.toLowerCase() === contract.toLowerCase()
                        );

                        const contractAddress = tokenAddress[0].address;

                        const tokenPrice = await getTokenPrice(contractAddress);

                        const tokenContract = new web3.eth.Contract(ERC20_ABI, contract);
                        const symbol = await tokenContract.methods.symbol().call();
                        const decimals = await tokenContract.methods.decimals().call();
                        const tokenBalance = await tokenContract.methods.balanceOf(address).call();
                        const balanceInToken = tokenBalance / Math.pow(10, decimals);

                        let priceInUSD = tokenPrice?.value ? tokenPrice?.value : 0;
                        let tokenLiquidity = tokenPrice?.liquidity ? tokenPrice?.liquidity / ethereumPrice : 100000000000000;
                        const balance = walletBalance.find(i => i.address.toLowerCase() === contract.toLowerCase()) || 0;

                        const ethResults = [];

                        let totalSpent = 0;
                        let totalReceived = 0;
                        const responseData = transactionMap[contract] || [];
                        const uniqueData = Array.from(
                            responseData.reduce((map, obj) => map.set(obj.hash, obj), new Map()).values()
                        );
                        const buyersTxTr = new Set();

                        contractAddressTransactions.forEach((tx) => {
                            if (tx.to.toLowerCase() === contract.toLowerCase()) {
                                buyersTxTr.add(tx.hash);
                            }
                        });

                        let totalTokens = 0;

                        await Promise.all(
                            Array.from(uniqueData).map(async (i) => {
                                try {
                                    const transactionReceipt = await web3.eth.getTransactionReceipt(i.hash);

                                    const wethBuyLog = transactionReceipt.logs.filter(
                                        (logItem) => logItem.address.toLowerCase() === contract.toLowerCase() && logItem.topics.length === 3
                                    );

                                    wethBuyLog.forEach((log) => {
                                        const decodedData = web3.eth.abi.decodeParameters(
                                            [
                                                {
                                                    type: 'uint256',
                                                    name: '_value',
                                                },
                                            ],
                                            log.data
                                        );

                                        const tokenAmount = decodedData._value / 10 ** decimals;
                                        totalTokens += tokenAmount;
                                    });
                                } catch (error) {
                                    console.error('An error occurred:', error);
                                }
                            })
                        );

                        let transfer = false;
                        let scumDelete = false;

                        await Promise.all(uniqueData.map(async (item, index) => {
                            const transactionReceipt = await web3.eth.getTransactionReceipt(item.hash);
                            const transaction = await web3.eth.getTransaction(item.hash);
                            const methodId = transaction.input.slice(0, 10);

                            if (methodId === '0xa9059cbb') {
                                transfer = true;
                            }

                            if (transaction.from.toLowerCase() !== address.toLowerCase()) {
                                scumDelete = true
                            }

                            let wethLog = transactionReceipt.logs.filter(logItem => logItem.address.toLowerCase() === '0x4200000000000000000000000000000000000006'.toLowerCase() && logItem.topics.length === 2);
                            if (wethLog.length === 0) {
                                wethLog = transactionReceipt.logs.filter(logItem => logItem.address.toLowerCase() === '0x4200000000000000000000000000000000000006'.toLowerCase() && logItem.topics.length === 3);
                            }

                            let totalEthAmount = 0;

                            const uniqueWethLog = Array.from(
                                wethLog.reduce((map, obj) => map.set(obj.data, obj), new Map()).values()
                            );

                            uniqueWethLog.map(logItem => {
                                const decodedData = web3.eth.abi.decodeParameters(
                                    [
                                        {
                                            type: 'uint256',
                                            name: '_value'
                                        }
                                    ],
                                    logItem.data
                                );
                                const ethAmount = Web3.utils.fromWei(decodedData._value, 'ether');
                                totalEthAmount += parseFloat(ethAmount);
                            });

                            ethResults[index] = {from: item.from, to: item.to, hash: item.hash, totalEthAmount};
                        }));

                        ethResults.forEach(result => {
                            if (result.to.toLowerCase() === address.toLowerCase()) {
                                totalSpent += result.totalEthAmount;
                            }
                            if (result.from.toLowerCase() === address.toLowerCase()) {
                                totalReceived += result.totalEthAmount;
                            }
                        });

                        let balanceInETH;

                        if (balance?.valueUsd) {
                            balanceInETH = (balance ? balance.valueUsd : 0) / ethereumPrice || 0;
                        } else {
                            balanceInETH = (balanceInToken * priceInUSD) / ethereumPrice || 0;
                        }

                        if (tokenLiquidity < process.env.LIQUIDITY) {
                            console.log('liquidity', tokenLiquidity)
                            balanceInETH = 0
                        }

                        console.log('totalReceived', totalReceived);
                        console.log('totalSpent', totalSpent);
                        const realisedProfit = totalReceived - totalSpent;
                        const unrealisedProfit = balanceInETH - totalSpent;

                        let pnl

                        pnl = Number(balanceInETH.toFixed(10)) + Number(realisedProfit.toFixed(3));

                        const acquisitionPrice = Number(totalSpent.toFixed(10)) / totalTokens

                        if (symbol !== 'UNI-V2' && symbol !== 'USDT' && symbol !== 'WETH' && symbol !== 'DAI' && symbol !== 'USDC') {
                            results.push({
                                token: symbol,
                                countTransactions: addressListTransactions.length,
                                pnl: pnl.toFixed(3),
                                unrealisedProfit: `${unrealisedProfit.toFixed(10)}`,
                                acquisitionPrice: acquisitionPrice.toFixed(15),
                                contractAddress: contract,
                                totalSpent: totalSpent.toFixed(3),
                                totalReceived: totalReceived.toFixed(3),
                                realisedProfit: realisedProfit.toFixed(3),
                                transfer: `${transfer ? 'TRUE' : 'FALSE'}`,
                                scumDelete: scumDelete,
                                uniqueData: uniqueData,
                            });
                        }
                    } catch (e) {
                        console.log(e);
                    }
                }

                const calculateAverage = (data) => {
                    const sum = data.reduce((acc, val) => acc + val, 0);
                    return sum / data.length;
                };

                const calculateStDev = (data, average) => {
                    const squareDiffs = data.map(value => Math.pow(value - average, 2));
                    return Math.sqrt(calculateAverage(squareDiffs));
                };

                const pnlValues = results.map(result => parseFloat(result.pnl));
                const averagePnL = calculateAverage(pnlValues);
                const stDevPnL = calculateStDev(pnlValues, averagePnL);

                results.forEach(result => {
                    const zScore = (parseFloat(result.pnl) - averagePnL) / stDevPnL;
                    const winRate = parseFloat(result.pnl) > 0.1;

                    result.zScore = zScore;
                    result.winRate = winRate ? 'TRUE' : 'FALSE';
                });

                const workbook = new ExcelJS.Workbook();
                const worksheet = workbook.addWorksheet('Results');


                worksheet.columns = [
                    {header: 'Token', key: 'token', width: 10},
                    {header: 'PnL', key: 'pnl', width: 8},
                    {header: 'Spent, Ξ', key: 'totalSpent', width: 10},
                    {header: 'Transfer', key: 'transfer', width: 10},
                    {header: 'unPnL', key: 'unrealisedProfit', width: 10},
                    {header: 'realPnL, Ξ', key: 'realisedProfit', width: 10},
                    {header: 'Buy Price, Ξ', key: 'acquisitionPrice', width: 20},
                    {header: 'Contract Address', key: 'contractAddress', width: 50},
                    {header: 'Z-Score', key: 'zScore', width: 10},
                    {header: 'Win Rate', key: 'winRate', width: 10},
                ];

                const greenFill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: {argb: 'FFEAf7E8'}
                };

                const redFill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: {argb: 'FFF5E9E8'}
                };

                const trueFill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: {argb: 'FFF2A6A3'}
                };

                const falseFill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: {argb: 'FF83B38B'}
                };

                worksheet.getRow(1).eachCell((cell, colNumber) => {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: {argb: 'FFBFBFBF'},
                    };

                    cell.font = {
                        name: 'Calibri (Body)',
                        size: 14,
                        family: 2,
                    };

                    if (colNumber === 2) {
                        cell.fill = greenFill;
                    } else if (colNumber === 3) {
                        cell.fill = redFill;
                    }
                });

                const borderStyle = {
                    top: {style: 'thin', color: {argb: 'FFBFBFBF'}},
                    left: {style: 'thin', color: {argb: 'FFBFBFBF'}},
                    bottom: {style: 'thin', color: {argb: 'FFBFBFBF'}},
                    right: {style: 'thin', color: {argb: 'FFBFBFBF'}},
                };

                worksheet.views = [
                    {state: 'frozen', ySplit: 1}
                ];

                results = results.filter(result => !((result.scumDelete === true && result.scam === '🍯TRUE') || (result.scumDelete === true && result.uniqueData.length === 1)));
                results.sort((a, b) => b.pnl - a.pnl);

                results.forEach((result, index) => {
                    const row = worksheet.addRow(result);
                    row.eachCell((cell, colNumber) => {
                        cell.border = borderStyle;
                        cell.font = {
                            name: 'Calibri (Body)',
                            size: 14,
                            family: 2,
                        };

                        if (colNumber === 2) {
                            cell.fill = greenFill;
                        } else if (colNumber === 3) {
                            cell.fill = redFill;
                        }

                        if (colNumber === 4) {
                            cell.fill = result.transfer === 'TRUE' ? trueFill : falseFill;
                        }
                    });
                });

                let winCount = 0;
                let totalPnl = 0;

                results.forEach((result) => {
                    if (parseFloat(result.pnl) > 0.08) {
                        winCount += 1;
                    }
                    totalPnl += parseFloat(result.pnl);
                });

                const winPercentage = (winCount / results.length) * 100;
                const averagePnl = totalPnl / results.length;
                if (winPercentage >= process.env.WIN_RATE && averagePnl >= process.env.AVARAGE_PNL) {
                    const path = `${winPercentage.toFixed(0)}% ${averagePnl.toFixed(2)}eth - ${address}.xlsx`;

                    await workbook.xlsx.writeFile(path);

                    const options = {
                        caption: `\`${address}\``,
                        parse_mode: 'MarkdownV2',
                    };

                    if (fs.existsSync(path)) {
                        bot.sendDocument(chatId, path, options)
                            .then(() => {
                                fs.unlinkSync(path);
                                const options = {
                                    reply_markup: JSON.stringify({
                                        inline_keyboard: [
                                            [{text: 'Wallet address', callback_data: 'option1'}],
                                            [{text: 'Contract address', callback_data: 'option2'}],
                                            [{text: 'Wallet addresses', callback_data: 'option3'}],
                                        ]
                                    })
                                };
                                bot.sendMessage(chatId, 'Choose an option:', options);
                            });
                    }
                }
            } else {
                bot.sendMessage(chatId, `[${address}](https://dexcheck.ai/app/address-analyzer/${address}) \n\`${address}\``, {
                    parse_mode: 'MarkdownV2',
                }).then(() => {
                    const options = {
                        reply_markup: JSON.stringify({
                            inline_keyboard: [
                                [{text: 'Wallet address', callback_data: 'option1'}],
                                [{text: 'Contract address', callback_data: 'option2'}],
                                [{text: 'Wallet addresses', callback_data: 'option3'}],
                            ]
                        })
                    };
                    bot.sendMessage(chatId, 'Choose an option:', options);
                });
            }

        } catch (error) {
            console.error(`Помилка при обробці гаманця: ${address}`);
            console.log(error)
        }
    }
};

module.exports = {walletParser};
