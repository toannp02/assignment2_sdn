const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/books", require("./routers/books"));
app.use("/api/members", require("./routers/members"));
app.use("/api/loans", require("./routers/loans"));

app.get("/", async (req, res) => {
  try {
    res.send({ message: "Welcome to Practical Exam!" });
  } catch (error) {
    res.send({ error: error.message });
  }
});

const PORT = process.env.PORT || 9999;
connectDB().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
