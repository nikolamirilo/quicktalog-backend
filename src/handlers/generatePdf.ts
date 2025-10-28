import { Bool, OpenAPIRoute } from "chanfana";
import { type AppContext } from "../types";

export class GeneratePdf extends OpenAPIRoute {
  schema = {
    tags: ["Utilities"],
    summary: "Pdf Generation",
  };

  async handle(c: AppContext) {
    const results = await c.env.database.exec("select * from logs");
    try {
      return c.json({
        success: true,
        result: results,
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
    }
  }
}
