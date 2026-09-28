FROM node:22-alpine

WORKDIR /app
ENV DOGFOOD_BACKEND_URL=http://backend:8000

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src

EXPOSE 5173

CMD ["npm", "run", "dev"]