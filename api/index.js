const { app, connectDB } = require("../server");

let databaseConnection;

module.exports = async (req, res) => {
  if (!databaseConnection) databaseConnection = connectDB();
  await databaseConnection;
  return app(req, res);
};
