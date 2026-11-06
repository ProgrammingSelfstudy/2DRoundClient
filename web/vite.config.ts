// Dev server: /loginapi is proxied to the login HTTP service, so the page (served on the LAN address) reaches it without CORS.
export default {
  server: {
    proxy: {
      "/loginapi": { target: "http://127.0.0.1:8081", changeOrigin: true, rewrite: (p: string) => p.replace(/^\/loginapi/, "") }
    }
  }
};
