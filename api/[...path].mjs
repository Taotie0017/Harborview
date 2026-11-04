import handler from "../lib/vercel-handler.mjs";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default handler;
