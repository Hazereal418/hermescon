export default {
  fetch(_req: Request): Response {
    return new Response("OK", {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
};
