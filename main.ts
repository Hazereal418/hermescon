const port = parseInt(Deno.env.get("PORT") || "8000");
Deno.serve({ port }, () => new Response("hello port " + port));
