export default {
  async fetch() {
    return Response.json({ ok: true, service: "vibble-api", version: "1.0.0" });
  },
};
