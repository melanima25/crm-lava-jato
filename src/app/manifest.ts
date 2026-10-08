import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TZ Auto Estética",
    short_name: "TZ Auto",
    description: "Gestão de atendimentos, clientes, caixa e estoque da TZ Auto Estética.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "pt-BR",
    theme_color: "#0e0e10",
    background_color: "#0e0e10",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
