const production = {
    SERVER_URL: 'https://financial-dashboard-api.herokuapp.com',
};

const development = {
    SERVER_URL: 'http://localhost:8000',
};

export const config = process.env.NODE_ENV === 'development' ? development : production;
