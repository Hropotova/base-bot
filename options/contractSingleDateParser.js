const fs = require('fs');
const ExcelJS = require('exceljs');

const {getBasePrice, getTokenBalances, getHistoryTrades, getTokenHistoryTransactions, getHistoryTokenPrice} = require('../api');

const contractSingleDateParser = async (dates, bot, chatId, addressState) => {
    try {
        const date = new Date(dates);
        const unixTime = Math.floor(date.getTime() / 1000);

        const basePrice = await getBasePrice();

        const trades = await getHistoryTrades(addressState, unixTime);

        const filteredTrades = trades
            .filter(trade => trade?.blockUnixTime < unixTime)
            .filter(trade => trade?.side === 'buy')

        const buyers = new Set();

        let symbol = filteredTrades[0].to.symbol;

        filteredTrades.map((trade) => {
            buyers.add(trade?.owner);
        })

        let results = [];
        for (const address of Array.from(buyers)) {
            let transactionsHistory = [];
            let tokenBalances = [];
            try {
                transactionsHistory = await getTokenHistoryTransactions(address);
            } catch (error) {
                console.error(`Error fetching transaction history for address ${address}:`, error);
                continue;
            }

            try {
                tokenBalances = await getTokenBalances(address);
            } catch (error) {
                console.error(`Error fetching token balances for address ${address}:`, error);
                continue;
            }

            if (transactionsHistory && tokenBalances) {
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
                                console.log('tokenPriceUSD', tokenPriceUSD)
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

                let profit;
                let spent;
                let received;
                let tokenSymbol;
                if (tokenSummary[addressState]) {
                    spent = tokenSummary.spent
                    received = tokenSummary.received
                    tokenSymbol = tokenSummary.tokenAddress
                    profit = received + spent;
                } else {
                    const trade = filteredTrades.findLast(i => i.owner === address && i.side === 'buy')
                    spent = trade.from.amount / Math.pow(10, 18)
                    received = 0
                    tokenSymbol = trade.to.address
                    profit = received + spent;
                }

                const tokenBalance = tokenBalances.find(i => i.address === tokenSymbol);

                const tokenValue = tokenBalance ? tokenBalance.valueUsd : 0;

                const tokenBalanceInSOL = tokenValue / basePrice;

                const pnl = tokenBalanceInSOL + profit;

                const transfer = tokenBalanceInSOL === 0 && spent === 0;

                results.push({
                    tokenName: address,
                    pnl: Number(pnl.toFixed(2)),
                    spent: Number(Math.abs(spent.toFixed(2))),
                    transfer: transfer ? 'TRUE' : 'FALSE',
                });
            }
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Results');

        worksheet.columns = [
            {header: 'Wallet', key: 'tokenName', width: 80},
            {header: 'PnL', key: 'pnl', width: 20},
            {header: 'Spent, Ξ', key: 'spent', width: 20},
            {header: 'Transfer', key: 'transfer', width: 20},
        ];

        const greenFill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: {argb: 'FFD7C7FF'}
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

        const path = `$${symbol} single - ${addressState}.xlsx`;

        await workbook.xlsx.writeFile(path);

        if (fs.existsSync(path)) {
            bot.sendDocument(chatId, path)
                .then(() => {
                    fs.unlinkSync(path);
                    const options = {
                        reply_markup: JSON.stringify({
                            inline_keyboard: [
                                [{text: 'Wallet address', callback_data: 'option1'}],
                                [{text: 'Contract address', callback_data: 'option2'}],
                            ]
                        })
                    };
                    bot.sendMessage(chatId, 'Choose an option:', options);
                });
        }
    } catch (error) {
        console.error(`Помилка при обробці гаманця: ${addressState}`);
        console.error(error);
    }
};

module.exports = {contractSingleDateParser};
