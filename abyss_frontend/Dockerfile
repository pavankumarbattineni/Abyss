FROM node:20.18.1

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy all source code and env file
COPY . .

# Build the Next.js app
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]