import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 8788);
createApp().listen(port, () => {
  console.log(`listening on ${port}`);
});
