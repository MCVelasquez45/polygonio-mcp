FROM node:20-alpine

WORKDIR /app

# Copy package files first for caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source
COPY . .

# Build TS
RUN npm run build

# Expose port (default 3000)
EXPOSE 3000

# Start command
CMD ["npm", "start"]
