const fs = require('fs');
const ExcelJS = require('exceljs');

const {getHistoryTransactions, getTokenBalances, getEthereumPrice, getHistoryTokenPrice} = require('../api');

const walletParser = async (addresses, bot, chatId) => {
    const splitAddresses = addresses.split('\n');

    const ethPriceUSD = await getEthereumPrice();

    for (const address of splitAddresses) {
        try {
            let results = [];
            const transactionsHistory = await getHistoryTransactions(address);

            const tokenBalances = await getTokenBalances(address);

            async function aggregateResults(data) {
                const rawResults = await Promise.all(data.map(async (transaction) => {
                    const tokenChanges = transaction.balanceChange;
                    let result = {txHash: transaction.txHash, tokenAddress: '', spent: 0, received: 0};

                    if (tokenChanges.length === 1) {
                        const {address: tokenAddress, amount} = tokenChanges[0];
                        if (amount < 0) {
                            const amountInTokens = Math.abs(amount) / Math.pow(10, 18);
                            var date = new Date(transaction.blockTime);
                            var unixTime = date.getTime() / 1000
                            const tokenPriceUSD = await getHistoryTokenPrice(tokenAddress, unixTime);
                            const received = (amountInTokens * tokenPriceUSD) / ethPriceUSD
                            result.tokenAddress = tokenAddress;
                            result.received = received;
                        }
                    } else if (tokenChanges.length > 1) {
                        const ethChange = tokenChanges.find(change => change.address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
                        if (ethChange && ethChange.amount < 0) {
                            const spent = Math.abs(ethChange.amount) / Math.pow(10, 18);
                            result.spent = spent;
                            result.tokenAddress = tokenChanges.find(change => change.address.toLowerCase() !== '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee').address;
                        }
                    }
                    return result;
                }));


                const aggregatedResults = rawResults.reduce((acc, {tokenAddress, spent, received}) => {
                    if (!acc[tokenAddress]) {
                        acc[tokenAddress] = {tokenAddress, spent: 0, received: 0};
                    }
                    acc[tokenAddress].spent += spent;
                    acc[tokenAddress].received += received;
                    return acc;
                }, {});


                return Object.values(aggregatedResults);
            }

            const tokenSummary = await aggregateResults(transactionsHistory)
            for (const token of tokenSummary) {
                if (token) {
                    const {spent, received, tokenAddress} = token;

                    const profit = received + spent;

                    const tokenBalance = tokenBalances.find(i => i.address === tokenAddress);
                    const tokenValue = tokenBalance ? tokenBalance.valueUsd : 0;

                    const tokenBalanceInSOL = tokenValue / ethPriceUSD;

                    const pnl = tokenBalanceInSOL + profit;

                    const transfer = tokenBalanceInSOL === 0 && spent === 0;

                    results.push({
                        tokenName: tokenBalance.symbol,
                        pnl: Number(pnl.toFixed(2)),
                        spent: Number(Math.abs(spent.toFixed(2))),
                        contractAddress: tokenAddress,
                        transfer: transfer ? 'TRUE' : 'FALSE',
                    });
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

                result.zScore = Number(zScore.toFixed(2))
                result.winRate = winRate ? 'TRUE' : 'FALSE';
            });

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Results');


            worksheet.columns = [
                {header: 'Token', key: 'tokenName', width: 15},
                {header: 'PnL', key: 'pnl', width: 10},
                {header: 'Spent, Ξ', key: 'spent', width: 10},
                {header: 'Transfer', key: 'transfer', width: 10},
                {header: 'Contract address', key: 'contractAddress', width: 70},
                {header: 'Z-Score', key: 'zScore', width: 10},
                {header: 'Win Rate', key: 'winRate', width: 10},
            ];

            const greenFill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: {argb: 'FFD7C7FF'},
            };

            const redFill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: {argb: 'FFF5E9E8'},
            };

            const trueFill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: {argb: 'FFF2A6A3'},
            };

            const falseFill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: {argb: 'FF83B38B'},
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
                {state: 'frozen', ySplit: 1},
            ];

            results.sort((a, b) => b.pnl - a.pnl);

            results.forEach((result) => {
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
                                ],
                            }),
                        };
                        bot.sendMessage(chatId, 'Choose an option:', options);
                    });
            }
        } catch (error) {
            console.error(`Помилка при обробці гаманця: ${address}`);
            console.error(error);
        }
    }
};

module.exports = {walletParser};
