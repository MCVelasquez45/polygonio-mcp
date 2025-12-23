module.exports = {
    experimental: {
        appDir: true,
    },
    async redirects() {
        return [
            {
                source: '/',
                destination: '/charts',
                permanent: false,
            },
        ];
    },
};
