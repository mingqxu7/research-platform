FROM node:20-alpine AS base
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .

FROM base AS development
CMD ["npm", "run", "dev"]

FROM base AS build
ARG NEXT_PUBLIC_API_URL=/api-backend
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/public ./public
COPY package.json .
CMD ["npm", "start"]
