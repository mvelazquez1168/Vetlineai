# Imagen de DESARROLLO — corre el servidor de Vite con hot reload contra el
# código montado como volumen desde docker-compose.
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
