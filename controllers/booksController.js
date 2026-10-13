const mongoose = require("mongoose");
const Book = require("../models/books");

const validateObjectId = (id, fieldName = "id") => {
  if (!id || !mongoose.isValidObjectId(String(id))) {
    throw new Error(`${fieldName} must be a valid ObjectId`);
  }
};

const getBooks = async (req, res) => {
  try {
    const books = await Book.find();
    res.status(200).json(books);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getBookById = async (req, res) => {
  try {
    validateObjectId(req.params.id, "Book id");
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ message: "Book not found" });
    res.status(200).json(book);
  } catch (error) {
    const status =
      error.message?.includes("valid ObjectId") || error.name === "CastError"
        ? 400
        : 500;
    res
      .status(status)
      .json({
        message: error.message || "An unexpected server error occurred",
      });
  }
};

const createBook = async (req, res) => {
  try {
    const book = await Book.create(req.body);
    res.status(201).json(book);
  } catch (error) {
    const status = error.code === 11000 ? 409 : 400;
    res.status(status).json({ message: error.message });
  }
};

const updateBook = async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ message: "Book not found" });
    book.overwrite(req.body);
    await book.save();
    res.status(200).json(book);
  } catch (error) {
    const status = error.code === 11000 ? 409 : 400;
    res.status(status).json({ message: error.message });
  }
};

const deleteBook = async (req, res) => {
  try {
    const book = await Book.findByIdAndDelete(req.params.id);
    if (!book) return res.status(404).json({ message: "Book not found" });
    res.status(200).json({ message: "Book deleted successfully" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const booksController = {
  getBooks,
  getBookById,
  createBook,
  updateBook,
  deleteBook,
};

module.exports = booksController;
