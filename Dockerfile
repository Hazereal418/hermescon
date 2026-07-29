FROM denoland/deno:2.9.4

WORKDIR /app

COPY . .

EXPOSE 8000

CMD ["run", "--allow-all", "main.ts"]
