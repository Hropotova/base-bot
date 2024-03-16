require('dotenv').config();
const axios = require('axios');

async function getAddressTokenTransaction(address) {
    try {
        const response = await axios.get(`https://api.basescan.org/api?module=account&action=tokentx&address=${address}&startblock=0&endblock=999999999&sort=asc&apikey=${process.env.BASESCAN_API_KEY}`);
        return response.data.result;
    } catch (error) {
        console.error('Error fetching data:', error.message);
        await new Promise(resolve => setTimeout(resolve, 5000));
        return getAddressTokenTransaction(address);
    }
}

async function getAddressListTransaction(address) {
    try {
        const response = await axios.get(`https://api.basescan.org/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&apikey=${process.env.BASESCAN_API_KEY}`);
        return response.data.result;
    } catch (error) {
        console.error('Error fetching data:', error.message);
        await new Promise(resolve => setTimeout(resolve, 5000));
        return getAddressListTransaction(address);
    }
}

async function getContractAddressTransactions(address, contract) {
    try {
        const response = await axios.get(`https://api.basescan.org/api?module=account&action=tokentx&address=${address}&contractaddress=${contract}&apikey=${process.env.BASESCAN_API_KEY}`);

        return response.data.result;
    } catch (error) {
        console.error('Error fetching contract address transactions:', error.message);
        await new Promise(resolve => setTimeout(resolve, 5000));
        return getContractAddressTransactions(address, contract);
    }
}

async function getAddressTransactionsSorted(address) {
    try {
        const response = await axios.get(`https://api.basescan.org/api?module=account&action=tokentx&contractaddress=${address}&startblock=0&endblock=99999999&sort=asc&apikey=${process.env.BASESCAN_API_KEY}`);
        return response.data.result;
    } catch (error) {
        console.error('Error fetching sorted transactions:', error.message);
        await new Promise(resolve => setTimeout(resolve, 5000));
        return getAddressTransactionsSorted(address);
    }
}

module.exports = {
    getAddressTokenTransaction,
    getAddressListTransaction,
    getContractAddressTransactions,
    getAddressTransactionsSorted
};
