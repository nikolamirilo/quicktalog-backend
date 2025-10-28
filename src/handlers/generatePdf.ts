import { Bool, OpenAPIRoute } from "chanfana";
import { type AppContext } from "../types";

export class GeneratePdf extends OpenAPIRoute {
  schema = {
    tags: ["Utilities"],
    summary: "Pdf Generation",
  };

  async handle(c: AppContext) {
    try {
      return c.json({
        success: true,
        result: c.env.ENV,
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
