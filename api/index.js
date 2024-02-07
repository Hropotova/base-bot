const axios = require('axios');

async function getBasePrice() {
    try {
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
            params: {
                ids: 'base',
                vs_currencies: 'usd',
            }
        });
        return response?.data?.base.usd;
    } catch (error) {
        console.error('Error fetching Base price:', error);
        throw error;
    }
}

async function getEthereumPrice() {
    try {
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
            params: {
                ids: 'ethereum',
                vs_currencies: 'usd',
            }
        });
        return response?.data?.ethereum.usd;
    } catch (error) {
        console.error('Error fetching Base price:', error);
        throw error;
    }
}

async function getHistoryTrades(token, unixStartTime) {
    try {
        let offset = 0;
        const limit = 50;
        let allTrades = [];

        while (true) {
            const response = await axios.get(`https://public-api.birdeye.so/defi/txs/token?address=${token}&offset=${offset}&limit=${limit}&tx_type=swap`, {
                headers: {
                    'x-chain': 'base',
                    'X-API-KEY': process.env.BIRDEYE_API_KEY,
                }
            });
            allTrades = allTrades.concat(response?.data?.data?.items);

            if (response?.data?.data?.hasNext && allTrades[allTrades.length - 1].blockUnixTime > unixStartTime) {
                offset += limit;
            } else {
                break;
            }
        }

        return allTrades;
    } catch (error) {
        console.error('Error fetching Base transactions:', error.message);
        throw error;
    }
}

async function getHistoryTransactions(address) {
    try {
        const response = await axios.get(
            `https://public-api.birdeye.so/v1/wallet/tx_list?wallet=${address}`,
            {
                headers: {
                    'x-chain': 'base',
                    'X-API-KEY': process.env.BIRDEYE_API_KEY
                }
            },
        );

        const data = response?.data?.data?.base
            .filter(item => item?.mainAction === 'swap')
            .filter(item => item?.status !== false);

        return data;
    } catch (error) {
        console.error('Error fetching Base transactions:', error);
        throw error;
    }
}

async function getTokenHistoryTransactions(address) {
    try {
        const response = await axios.get(
            `https://public-api.birdeye.so/v1/wallet/tx_list?wallet=${address}&limit=1000`,
            {
                headers: {
                    'x-chain': 'base',
                    'X-API-KEY': process.env.BIRDEYE_API_KEY
                }
            },
        );

        const data = response?.data?.data?.base
            .filter(item => item.contractLabel !== null)
            .filter(item => item.balanceChange[0]?.amount !== 0)
            .filter(item => item.balanceChange[1]?.name !== undefined)
            .filter(item => item.balanceChange[1]?.symbol !== undefined)
            .filter(item => item?.status !== false);

        return data;
    } catch (error) {
        console.error('Error fetching Base transactions:', error.message);
        throw error;
    }
}

async function getTokenBalances(address) {
    try {
        const response = await axios.get(
            `https://public-api.birdeye.so/v1/wallet/token_list?wallet=${address}`,
            {
                headers: {
                    'x-chain': 'base',
                    'X-API-KEY': process.env.BIRDEYE_API_KEY,
                }
            },
        );
        return response?.data?.data?.items;
    } catch (error) {
        console.error('Error fetching token balance:', error.message);
        throw error;
    }
}

async function getHistoryTokenPrice(address, timeFrom) {
    try {
        const response = await axios.get(
            `https://public-api.birdeye.so/defi/history_price?address=${address}&address_type=token&type=1m&time_from=${timeFrom}&time_to=${timeFrom + 1000}`,
            {
                headers: {
                    'x-chain': 'base',
                    'X-API-KEY': process.env.BIRDEYE_API_KEY,
                }
            },
        );
        return response?.data?.data?.items[0].value;
    } catch (error) {
        console.error('Error fetching token balance:', error.message);
        throw error;
    }
}

module.exports = {
    getBasePrice,
    getHistoryTransactions,
    getTokenBalances,
    getHistoryTrades,
    getTokenHistoryTransactions,
    getHistoryTokenPrice,
    getEthereumPrice
};
