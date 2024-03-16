const axios = require('axios');

async function getEthereumPrice() {
    try {
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
            params: {
                ids: 'ethereum',
                vs_currencies: 'usd'
            }
        });
        return response.data.ethereum.usd;
    } catch (error) {
        console.error('Error fetching Ethereum price:', error);
        throw error;
    }
}

async function getTokenPrice(contract) {
    try {
        const response = await axios.get(
            `https://public-api.birdeye.so/defi/price?include_liquidity=true&address=${contract}`,
            {
                headers: {
                    'x-chain': 'base',
                    'X-API-KEY': process.env.BIRDEYE_API_KEY
                }
            },
        );

        const data = response?.data?.data

        return data;
    } catch (error) {
        console.error('Error fetching token price:', error);
        throw error;
    }
}

async function getWalletBalance(address) {
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

module.exports = {getEthereumPrice, getTokenPrice, getWalletBalance};
