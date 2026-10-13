const mongoose = require("mongoose");
const Book = require("../models/books");
const Loan = require("../models/loans");
const Member = require("../models/members");

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const populateLoan = (query) =>
  query.populate("member_id").populate("items.book_id");

const validateObjectId = (id, fieldName) => {
  if (typeof id !== "string" || !mongoose.isValidObjectId(id)) {
    throw new RequestError(400, `${fieldName} must be a valid ObjectId`);
  }
};

const getErrorStatus = (error) => {
  if (error?.status) return error.status;
  if (error?.code === 11000) return 409;
  if (["ValidationError", "CastError"].includes(error?.name)) return 400;
  return 500;
};

const getErrorMessage = (error) =>
  error?.message || "An unexpected server error occurred";

const aggregateItems = (items) => {
  const quantities = new Map();
  for (const item of items) {
    if (!item || typeof item !== "object") {
      throw new RequestError(
        400,
        "Each loan item must include a book_id and quantity",
      );
    }
    const bookIdValue = item.book_id ?? item.bookId;
    if (!mongoose.isValidObjectId(bookIdValue)) {
      throw new RequestError(400, "book_id or bookId must be a valid ObjectId");
    }
    const bookId = bookIdValue.toString();
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new RequestError(400, "Book quantity must be a positive integer");
    }
    quantities.set(bookId, (quantities.get(bookId) || 0) + item.quantity);
  }
  return quantities;
};

const restoreReservedCopies = async (reservations) => {
  for (const reservation of reservations.reverse()) {
    try {
      await Book.updateOne(
        { _id: reservation.bookId },
        { $inc: { availableCopies: reservation.quantity } },
      );
    } catch (error) {
      console.error("Failed to restore book inventory after loan error", error);
    }
  }
};

const getLoans = async (req, res) => {
  try {
    const loans = await populateLoan(Loan.find());
    res.status(200).json(loans);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getLoansByMember = async (req, res) => {
  try {
    validateObjectId(req.params.memberId, "memberId");
    const member = await Member.findById(req.params.memberId);
    if (!member) return res.status(404).json({ message: "Member not found" });
    const loans = await populateLoan(Loan.find({ member_id: member._id }));
    res.status(200).json(loans);
  } catch (error) {
    res.status(getErrorStatus(error)).json({ message: getErrorMessage(error) });
  }
};

const getLoanById = async (req, res) => {
  try {
    validateObjectId(req.params.id, "loan id");
    const loan = await populateLoan(Loan.findById(req.params.id));
    if (!loan) return res.status(404).json({ message: "Loan not found" });
    res.status(200).json(loan);
  } catch (error) {
    res.status(getErrorStatus(error)).json({ message: getErrorMessage(error) });
  }
};

const createLoan = async (req, res) => {
  const reservations = [];
  let loanSaved = false;
  try {
    const { member_id, items, borrowDate, dueDate } = req.body || {};
    validateObjectId(member_id, "member_id");
    if (!Array.isArray(items) || items.length === 0) {
      throw new RequestError(400, "A loan must contain at least one book");
    }

    const loanItems = items.map((item) => ({
      book_id: item?.book_id ?? item?.bookId,
      quantity: item?.quantity,
    }));
    const quantities = aggregateItems(loanItems);
    const member = await Member.findById(member_id);
    if (!member) throw new RequestError(404, "Member not found");
    if (!member.isActive) {
      throw new RequestError(
        409,
        "Inactive members are not allowed to borrow books",
      );
    }

    const bookIds = [...quantities.keys()];
    const books = await Book.find({ _id: { $in: bookIds } });
    const booksById = new Map(books.map((book) => [book._id.toString(), book]));
    for (const bookId of bookIds) {
      if (!booksById.has(bookId)) {
        throw new RequestError(404, `Book not found: ${bookId}`);
      }
    }

    const loan = new Loan({
      member_id,
      items: loanItems,
      borrowDate,
      dueDate,
      returnDate: null,
      status: "Borrowing",
    });
    await loan.validate();

    for (const [bookId, quantity] of quantities) {
      const book = await Book.findOneAndUpdate(
        { _id: bookId, availableCopies: { $gte: quantity } },
        { $inc: { availableCopies: -quantity } },
        { new: true },
      );
      if (!book) {
        const currentBook = booksById.get(bookId);
        const latestBook = await Book.findById(bookId);
        if (!latestBook)
          throw new RequestError(404, `Book not found: ${bookId}`);
        throw new RequestError(
          409,
          `Insufficient copies of "${currentBook.title}": requested ${quantity}, available ${latestBook.availableCopies ?? 0}`,
        );
      }
      reservations.push({ bookId, quantity });
    }

    await loan.save();
    loanSaved = true;
    const populatedLoan = await populateLoan(Loan.findById(loan._id));
    res.status(201).json(populatedLoan);
  } catch (error) {
    if (!loanSaved) await restoreReservedCopies(reservations);
    res.status(getErrorStatus(error)).json({ message: getErrorMessage(error) });
  }
};

const updateLoan = async (req, res) => {
  try {
    validateObjectId(req.params.id, "loan id");
    const body = req.body || {};
    const protectedFields = ["member_id", "items", "status", "returnDate"];
    if (protectedFields.some((field) => Object.hasOwn(body, field))) {
      throw new RequestError(
        400,
        "Use the return endpoint to return a loan; borrower and book items cannot be changed",
      );
    }
    const update = {};
    for (const field of ["borrowDate", "dueDate"]) {
      if (Object.hasOwn(body, field)) update[field] = body[field];
    }
    if (Object.keys(update).length === 0) {
      throw new RequestError(400, "Provide borrowDate or dueDate to update");
    }

    const loan = await Loan.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });
    if (!loan) return res.status(404).json({ message: "Loan not found" });
    const populatedLoan = await populateLoan(Loan.findById(loan._id));
    res.status(200).json(populatedLoan);
  } catch (error) {
    res.status(getErrorStatus(error)).json({ message: getErrorMessage(error) });
  }
};

const returnLoan = async (req, res) => {
  try {
    validateObjectId(req.params.id, "loan id");
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ message: "Loan not found" });
    if (loan.status === "Returned" || loan.returnDate) {
      throw new RequestError(409, "This loan has already been returned");
    }

    const quantities = aggregateItems(loan.items);
    const bookIds = [...quantities.keys()];
    const books = await Book.find({ _id: { $in: bookIds } });
    const booksById = new Map(books.map((book) => [book._id.toString(), book]));
    for (const bookId of bookIds) {
      if (!booksById.has(bookId)) {
        throw new RequestError(
          409,
          `Book ${bookId} no longer exists; loan inventory cannot be restored`,
        );
      }
    }

    const returnDate = new Date();
    const returnedLoan = await Loan.findOneAndUpdate(
      {
        _id: loan._id,
        status: loan.status,
        returnDate: null,
      },
      { $set: { returnDate, status: "Returned" } },
      { new: true, runValidators: true },
    );
    if (!returnedLoan) {
      throw new RequestError(
        409,
        "This loan is already being returned or has been returned",
      );
    }

    const restored = [];
    try {
      for (const [bookId, quantity] of quantities) {
        const result = await Book.updateOne(
          { _id: bookId },
          { $inc: { availableCopies: quantity } },
        );
        if (result.matchedCount !== 1) {
          throw new RequestError(409, `Book ${bookId} could not be restocked`);
        }
        restored.push({ bookId, quantity });
      }
    } catch (error) {
      await restoreReservedCopies(restored);
      await Loan.updateOne(
        { _id: returnedLoan._id, status: "Returned", returnDate },
        { $set: { status: loan.status, returnDate: null } },
      );
      throw error;
    }

    const populatedLoan = await populateLoan(Loan.findById(returnedLoan._id));
    res.status(200).json(populatedLoan);
  } catch (error) {
    res.status(getErrorStatus(error)).json({ message: getErrorMessage(error) });
  }
};

const deleteLoan = async (req, res) => {
  try {
    validateObjectId(req.params.id, "loan id");
    const existingLoan = await Loan.findById(req.params.id);
    if (!existingLoan)
      return res.status(404).json({ message: "Loan not found" });
    if (existingLoan.status !== "Returned") {
      throw new RequestError(
        409,
        "An active loan cannot be deleted; return it first",
      );
    }
    const loan = await Loan.findByIdAndDelete(req.params.id);
    if (!loan) throw new RequestError(404, "Loan not found");
    res.status(200).json({ message: "Loan deleted successfully" });
  } catch (error) {
    res.status(getErrorStatus(error)).json({ message: getErrorMessage(error) });
  }
};

const loansController = {
  getLoans,
  getLoansByMember,
  getLoanById,
  createLoan,
  updateLoan,
  returnLoan,
  deleteLoan,
};

module.exports = loansController;
