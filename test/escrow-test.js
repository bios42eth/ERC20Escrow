const chai = require("chai");
const expect = chai.expect;
const { ethers } = require("hardhat");
const { smock } = require("@defi-wonderland/smock");
const { BigNumber } = require("@ethersproject/bignumber");

chai.use(smock.matchers);

describe("Escrow", function () {
  let admin, buyer, buyer2, merchant;
  let escrow;
  let b42Token;
  const onehundred = ethers.utils.parseEther("100");

  let initial_buyer_balance, initial_merchant_balance, initial_escrow_balance;

  async function initializeEscrow(tokenAddress) {
    const Escrow = await ethers.getContractFactory("Escrow");
    escrow = await Escrow.deploy(tokenAddress);
    await escrow.deployed();
  }

  beforeEach(async function () {
    [admin, buyer, merchant, buyer2, merchant2] = await ethers.getSigners();
    const B42Token  = await ethers.getContractFactory("B42Token");
    b42Token = await B42Token.deploy();
    await b42Token.deployed();

    await b42Token.mint(buyer.address, onehundred);
    await b42Token.mint(buyer2.address, onehundred);

    await initializeEscrow(b42Token.address)

    initial_buyer_balance = await b42Token.balanceOf(buyer.address);
    initial_merchant_balance = await b42Token.balanceOf(merchant.address);
    initial_escrow_balance = await b42Token.balanceOf(escrow.address);

    await b42Token.connect(buyer).approve(escrow.address, onehundred);
    await b42Token.connect(buyer2).approve(escrow.address, onehundred);

  });

  describe("lock", function() {
    it("should withdraw the buyers tokens", async function() {
        await escrow.connect(buyer).lock(merchant.address, onehundred);

        expect(await escrow.lockedInBalance(buyer.address,merchant.address)).to.equal(onehundred);

        expect(await b42Token.balanceOf(buyer.address)).to.equal(initial_buyer_balance - onehundred);
        expect(await b42Token.balanceOf(escrow.address)).to.equal(initial_escrow_balance + onehundred);
    });

    it("should sum locked tokens", async function() {
      await escrow.connect(buyer).lock(merchant.address, ethers.utils.parseEther("10"));
      await escrow.connect(buyer).lock(merchant.address, ethers.utils.parseEther("10"));

      expect(await escrow.lockedInBalance(buyer.address,merchant.address))
        .to.equal(ethers.utils.parseEther("20"));
    });

    it("should check there is enough balance", async function() {
      try {
        await escrow.connect(buyer).lock(merchant.address, ethers.utils.parseEther("1000"));
        throw new Error("This should not work !");
      } catch (err) {
        expect(err.message).to.eq("VM Exception while processing transaction: reverted with reason string 'ERC20: transfer amount exceeds balance'");
      }
        expect(await escrow.lockedInBalance(buyer.address,merchant.address))
          .to.equal(ethers.utils.parseEther("0"));
    });

    it("should check the escrow is authorized", async function() {
      await b42Token.connect(buyer).approve(escrow.address, ethers.utils.parseEther("10"));

      try {
        await escrow.connect(buyer).lock(merchant.address, ethers.utils.parseEther("100"));
        throw new Error("This should not work !");
      } catch (err) {
        expect(err.message).to.eq("VM Exception while processing transaction: reverted with reason string 'ERC20: transfer amount exceeds allowance'");
      }
        expect(await escrow.lockedInBalance(buyer.address,merchant.address))
          .to.equal(ethers.utils.parseEther("0"));
    });

    it("should check the transferFrom worked fine", async function() {
      const MockFactory = await smock.mock('B42Token');
      const mock = await MockFactory.deploy();
      await mock.mint(buyer.address, onehundred);

      await initializeEscrow(mock.address);

      await mock.connect(buyer).approve(escrow.address, onehundred);

      try {
        mock.transferFrom.returns(false);
        await escrow.connect(buyer).lock(merchant.address, onehundred);
        throw new Error("This should not work !");
      } catch (err) {
        expect(err.message).to.eq("VM Exception while processing transaction: reverted with reason string 'SafeERC20: ERC20 operation did not succeed'");
      }

   });


  })

  describe("release", function() {
    it("should credit the merchant balance", async function() {
      await escrow.connect(buyer).lock(merchant.address, onehundred);

      expect(await escrow.claimableBalance(merchant.address)).to.equal(0);

      await escrow.connect(buyer).release(merchant.address);

      expect(await escrow.claimableBalance(merchant.address)).to.equal(onehundred);
    });

    it("should segragate locked amount", async function() {
      await escrow.connect(buyer).lock(merchant.address, onehundred);
      await escrow.connect(buyer2).lock(merchant2.address, onehundred);

      await escrow.connect(buyer).release(merchant.address);

      expect(await escrow.claimableBalance(merchant.address)).to.equal(onehundred);
      expect(await escrow.claimableBalance(merchant2.address)).to.equal(0);
    });

    it("should allow to release only once", async function() {
      await escrow.connect(buyer).lock(merchant.address, onehundred);

      await escrow.connect(buyer).release(merchant.address);
      await escrow.connect(buyer).release(merchant.address);

      expect(await escrow.claimableBalance(merchant.address)).to.equal(onehundred);
    });

    it("should sum all released amount", async function() {
      await escrow.connect(buyer).lock(merchant.address, onehundred);
      await escrow.connect(buyer).release(merchant.address);

      await escrow.connect(buyer2).lock(merchant.address, onehundred);
      await escrow.connect(buyer2).release(merchant.address);

      expect(await escrow.claimableBalance(merchant.address))
        .to.equal(ethers.utils.parseEther("200"));
    });

  })

  describe("claim", function() {
    it("transfer the funds after being approved transaction", async function () {
      await escrow.connect(buyer).lock(merchant.address, onehundred);
      await escrow.connect(buyer).release(merchant.address);
      await escrow.connect(merchant).claim();

      expect(await b42Token.balanceOf(merchant.address)).to.equal(initial_merchant_balance + onehundred);
    });

    it("should allow to claim only once", async function () {
      await escrow.connect(buyer).lock(merchant.address, onehundred);
      await escrow.connect(buyer2).lock(merchant2.address, onehundred);
      await escrow.connect(buyer).release(merchant.address);
      await escrow.connect(buyer2).release(merchant2.address);

      await escrow.connect(merchant).claim();
      await escrow.connect(merchant).claim();

      expect(await b42Token.balanceOf(merchant.address)).to.equal(initial_merchant_balance + onehundred);
    });

      it("should not release before buyer's approval", async function () {
        await escrow.connect(buyer).lock(merchant.address, onehundred);
        await escrow.connect(merchant).claim();

        expect(await b42Token.balanceOf(merchant.address)).to.equal(initial_merchant_balance);
      });

      it("should check the transfer worked fine", async function() {
        const MockFactory = await smock.mock('B42Token');
        const mock = await MockFactory.deploy();
        await mock.mint(buyer.address, onehundred);

        await initializeEscrow(mock.address);

        await mock.connect(buyer).approve(escrow.address, onehundred);

        await escrow.connect(buyer).lock(merchant.address, onehundred);
        await escrow.connect(buyer).release(merchant.address);

        try {
          mock.transfer.returns(false);
          await escrow.connect(merchant).claim();
          throw new Error("This should not work !");
        } catch (err) {
          expect(err.message).to.eq("VM Exception while processing transaction: reverted with reason string 'SafeERC20: ERC20 operation did not succeed'");
        }

     });


  })


 });
