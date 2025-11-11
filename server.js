import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import svgRouter from "./routes/svg.js";

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

// API routes
app.use("/api/svg", svgRouter);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
