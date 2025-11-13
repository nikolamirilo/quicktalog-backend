import { Bool, OpenAPIRoute } from "chanfana";
import { type AppContext } from "../types";
import z from "zod";
import { revalidateData } from "../helpers";

export class GeneratePdf extends OpenAPIRoute {
  schema = {
    tags: ["Utilities"],
    summary: "Pdf Generation",
  };

  async handle(c: AppContext) {
    const res = await c.env.database.exec("SELECT * FROM logs");
    const { results } = await c.env.database
      .prepare("SELECT * from logs")
      .bind(true)
      .all();
    try {
      return c.json({
        success: true,
        result: results,
        res: res,
      });
    } catch (error) {
      console.error("Error occured", error);
      return c.json(
        {
          success: false,
          error: error,
        },
        500
      );
    } finally {
      await revalidateData(c.env.APP_URL);
    }
  }
}
