# Imagen de DESARROLLO — corre ts-node-dev con hot reload contra el código
# montado como volumen desde docker-compose. No es la imagen de producción
# (esa se agrega cuando el proyecto llegue a esa fase: build multi-stage +
# `npm run build` + `node dist/index.js`).
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 4000

CMD ["npm", "run", "dev"]
