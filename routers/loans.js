const express = require("express");
const router = express.Router();
const loansController = require("../controllers/loansController");

router.get("/", loansController.getLoans);
router.get("/member/:memberId", loansController.getLoansByMember);
router.get("/:id", loansController.getLoanById);
router.post("/", loansController.createLoan);
router.put("/:id/return", loansController.returnLoan);
router.put("/:id", loansController.updateLoan);
router.delete("/:id", loansController.deleteLoan);

module.exports = router;
