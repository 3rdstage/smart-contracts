
const Token = artifacts.require("ERC20Regular");
const Chance = require('chance');
const { BN, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const toBN = web3.utils.toBN;

//References
//Truffle test in JavaScript : https://www.trufflesuite.com/docs/truffle/testing/writing-tests-in-javascript
//Truffle Contract Guide : https://www.trufflesuite.com/docs/truffle/getting-started/interacting-with-your-contracts
//Truffle Contract Package : https://github.com/trufflesuite/truffle/tree/master/packages/contract
//Mocha Documentation : https://mochajs.org/#getting-started
//Chai Assert API : https://www.chaijs.com/api/assert/
//Chai Expect/Should API : https://www.chaijs.com/api/bdd/
//OpenZeppelin Test Helpers API : https://docs.openzeppelin.com/test-helpers/0.5/api
//web3 API : https://web3js.readthedocs.io/en/v1.2.11/
//chance.js : https://chancejs.com/
//bn.js : https://github.com/indutny/bn.js/
//JavaScript Reference (MDN) : https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference
//The Modern JavaScript Tutorial : http://javascript.info/

contract("ERC20Regular Contract Test Suite", async accounts => {

  "use strict";

  // avoid too many accounts
  if(accounts.length > 8) accounts = (new Chance()).pickset(accounts, 8);

  //const creator1 = accounts[0];  // default token creator in test - admin, minter, pauser
  //const creator2 = accounts[1];

  const EventNames = {
      Transfer: 'Transfer',
      Approval: 'Approval'
  }
  
  const Skips = {  // flags to control skip of each sub test suite.
    InitialState: false,
    Minting: false,
    Transfer: false,
    Approval: false,
    DelegatedTransfer: false,
    Burning: false,
    CircuitBreaker: false
  }

  before(async() => {
    const output = [];
    let balance = 0;
    for(const acct of accounts){
      await web3.eth.personal.unlockAccount(acct);
      balance = await web3.eth.getBalance(acct);
      await output.push([acct, balance]);
    }

    console.debug(`The number of accounts : ${accounts.length}`);
    console.table(output);
  });

  describe("Initial State", () => {
    
    before(() => {
      if(Skips.InitialState) this.skip();
    });

    // name(), symbol(), decimals()
    it("Should have 'name' and 'symbol' specified at the constructor and always have '18' for the decimals.", async() => {
      const chance = new Chance();
      const name = chance.sentence({words: 3});
      const symbol = chance.word({length: chance.natural({min: 1, max: 5})}).toUpperCase();
      const admin = chance.pickone(accounts);
      const token = await Token.new(name, symbol, {from: admin});
      console.debug(`New token contract deployed - name: ${name}, symbol: ${symbol}, address: ${token.address}`);

      // inquire and verify token's name, symbol and decimals
      assert.equal(await token.name(), name);
      assert.equal(await token.symbol(), symbol);
      assert.isTrue((await token.decimals()).eqn(18));
    });


    // totalSupply(), paused(), balanceOf()
    it("Should have ZERO supply, not be paused, and set ZERO balances for all accounts at inital state.", async() => {
      const chance = new Chance();
      const token = await Token.new('Color Token', 'RGB', {from: chance.pickone(accounts)});
      console.debug(`New token contract deployed - address: ${token.address}`);

      const total = await token.totalSupply();
      const paused = await token.paused();

      assert.isTrue(total.isZero());
      assert.isFalse(paused);

      let balance = 0;
      for(const acct of accounts){
        balance = await token.balanceOf(acct);
        assert.isTrue(balance.isZero());
      }
    });
  });

  describe("Minting", () => {
    
    // mint(), totalSupply(), balanceOf()
    it("Can mint tokens increasing the owners balance and total supply as much", async() => {
      const chance = new Chance();
      const admin = chance.pickone(accounts);
      const token = await Token.new('Color Token', 'RGB', {from: admin});
      console.debug(`New token contract deployed - address: ${token.address}`);

      const amt0 = toBN(1E17);
      let amt = null;
      let balance1 = 0, balance2 = 0;
      let total1 = 0, total2 = 0;
      for(const acct of accounts){
        balance1 = await token.balanceOf(acct);
        total1 = await token.totalSupply();

        // mint
        amt = amt0.muln(chance.natural({min: 1, max: 100}));
        await token.mint(acct, amt, {from: admin});

        balance2 = await token.balanceOf(acct);
        total2 = await token.totalSupply();

        assert.isTrue(balance2.eq(balance1.add(amt)), "Minting should increase balance of the minted account as much.");
        assert.isTrue(total2.eq(total1.add(amt)), "Minting should increase total supply as much.");
      }
    });

    // mint(), grantRole()
    it("Can mint token only by minters(accounts granted minter role).", async() =>{
      const chance = new Chance();
      const admin = chance.pickone(accounts);
      const token = await Token.new('Color Token', 'RGB', {from: admin});
      console.debug(`New token contract deployed - address: ${token.address}`);

      let tryer = null;
      do{ // select any account other than admin
        tryer = chance.pickone(accounts);
      }while(tryer == admin)

      let amt = 0;
      for(const acct of accounts){
        amt = toBN(1E17).muln(chance.natural({min: 1, max: 100}));
        // tryer is not minter or admin yet
        await expectRevert.unspecified(token.mint(acct, amt, {from: tryer}));
      }

      // maker tryer minter
      await token.grantRole(await token.MINTER_ROLE(), tryer, {from: admin});

      // try again as a minter
      for(const acct of accounts){
        amt = toBN(1E17).muln(chance.natural({min: 1, max: 100}));
        await token.mint(acct, amt, {from: tryer});
      }

    });

    it("Should fire 'Transfer' event after minting.", async() => {
      const chance = new Chance();
      const admin = chance.pickone(accounts);
      const token = await Token.new('Color Token', 'RGB', {from: admin});
      console.debug(`New token contract deployed - address: ${token.address}`);

      let amt = 0;
      for(const acct of accounts){
        amt = toBN(1E17).muln(chance.natural({min: 1, max: 100}));

        expectEvent(await token.mint(acct, amt, {from: admin}),
          EventNames.Transfer, {1: acct, 2: amt});
      }
    })
  });

  describe("Transfer", () => {
    
    // mint(), balanceOf(), transfer()
    it("Can transfer decreasing sender's balance and increasing recipient's balance as much.", async() => {
      const chance = new Chance();
      const admin = chance.pickone(accounts);
      const token = await Token.new('Color Token', 'RGB', {from: admin});
      console.debug(`New token contract deployed - address: ${token.address}`);

      // mint initial balances to all accounts
      let balance = 0;
      for(const acct of accounts){
        balance = toBN(1E19).muln(chance.natural({min: 1, max: 100}));
        await token.mint(acct, balance, {from: admin});
      }
      
      const loops = 20;
      let sender = null, recipient = null;
      let delta = 0;
      let senderBal1 = 0, senderBal2 = 0;
      let recipientBal1 = 0, recipientBal2 = 0;
      for(let i = 0; i < loops; i++){
        sender = chance.pickone(accounts);
        do{
          recipient = chance.pickone(accounts);
        }while(recipient == sender)
          
        senderBal1 = await token.balanceOf(sender);
        recipientBal1 = await token.balanceOf(recipient);
        
        // amount to transfer can be ZERO
        delta = toBN(1E13).muln(chance.natural({min: 0, max: 100}));
        await token.transfer(recipient, delta, {from: sender});
        
        senderBal2 = await token.balanceOf(sender);
        recipientBal2 = await token.balanceOf(recipient);
        
        assert.isTrue(senderBal2.eq(senderBal1.sub(delta)), 
            "The sender's balance should be decreased as much after a transfer.");
        assert.isTrue(recipientBal2.eq(recipientBal1.add(delta)), 
            "The recipient's balance should be increased as much after a transfer.");
      }
    });  

    it("Can't transfer to ZERO address from any account", async() => {
      const chance = new Chance();
      const admin = chance.pickone(accounts);
      const token = await Token.new('Color Token', 'RGB', {from: admin});
      console.debug(`New token contract deployed - address: ${token.address}`);

      // mint initial balances to all accounts
      let balance = 0;
      for(const acct of accounts){
        balance = toBN(1E9).muln(chance.natural({min: 1, max: 100}));
        await token.mint(acct, balance, {from: admin});
      }
      
      const loops = 20;
      let delta = 0;
      for(const acct of accounts){
        delta = toBN(1E3).muln(chance.natural({min: 0, max: 100}));
        await expectRevert(token.transfer('0x0', delta, {from: acct}), "invalid address");
      }
    });

    
    // mint(), balanceOf(), transfer()
    it("Can transfer to oneself, although it seems a little bit silly.", async() => {
      const chance = new Chance();
      const admin = chance.pickone(accounts);
      const token = await Token.new('Color Token', 'RGB', {from: admin});
      console.debug(`New token contract deployed - address: ${token.address}`);

      // mint initial balances to all accounts
      let balance = 0;
      for(const acct of accounts){
        balance = toBN(1E19).muln(chance.natural({min: 1, max: 100}));
        await token.mint(acct, balance, {from: admin});
      }
      
      const loops = 20;
      let sender = null, delta = 0;
      let balance1 = 0, balance2 = 0;
      for(let i = 0; i < loops; i++){
        sender = chance.pickone(accounts);
        balance1 = await token.balanceOf(sender);
        delta = toBN(1E13).muln(chance.natural({min: 0, max: 100}));
        await token.transfer(sender, delta, {from: sender});
        balance2 = await token.balanceOf(sender);
        
        assert.isTrue(balance2.eq(balance1),
            "Self transfer is possible and dosen't change balance.");
      }
    });

    
    // mint(), balanceOf(), transfer()
    it("Can transfer zero amount, although such a empty transfer seems a little bit silly.", async() => {
      const chance = new Chance();
      const admin = chance.pickone(accounts);
      const token = await Token.new('Color Token', 'RGB', {from: admin});
      console.debug(`New token contract deployed - address: ${token.address}`);

      // mint initial balances to all accounts
      let balance = 0;
      for(const acct of accounts){
        balance = toBN(1E5).muln(chance.natural({min: 1, max: 100}));
        await token.mint(acct, balance, {from: admin});
      }
      
      const loops = 20;
      const delta = 0;
      let sender = null, recipient = null;;
      for(let i = 0; i < loops; i++){
        sender = chance.pickone(accounts);
        recipient = chance.pickone(accounts);
        await token.transfer(sender, delta, {from: sender});
      }      
    });
    
    
   // mint(), balanceOf(), transfer()
    it("Should not change balances of irrelative accounts(neither sender nor recipient).", async() => {
      const chance = new Chance();
      const admin = chance.pickone(accounts);
      const token = await Token.new('Color Token', 'RGB', {from: admin});
      console.debug(`New token contract deployed - address: ${token.address}`);
      console.debug(`This test case will take a little bit long time.`);
      
      // mint initial balances to all accounts
      let balance = 0;
      for(const acct of accounts){
        balance = toBN(1E19).muln(chance.natural({min: 1, max: 100}));
        await token.mint(acct, balance, {from: admin});
      }
      
      const loops = 20;
      let sender = null, recipient = null;
      let delta = 0, balances = null;
      for(let i = 0; i < loops; i++){
        sender = chance.pickone(accounts);
        recipient = chance.pickone(accounts);
        balances = new Map();
        for(const acct of accounts){ // record others' balances before the transfer
          if(acct == sender || acct == recipient) continue
          balances.set(acct, await token.balanceOf(acct));
        }

        await token.transfer(sender, delta, {from: recipient});
        
        // check the balances of others' account after transfer
        for(const acct of accounts){
          if(acct == sender || acct == recipient) continue;
          assert.isTrue((await token.balanceOf(acct)).eq(balances.get(acct)),
            "Transfer should not change balance of irrelative accounts");
        }
      }
    });    
    
    
    // mint(), totalSupply(), transfer()
    it("Should not change total supply at all after trasnfers.", async() => {
      const chance = new Chance();
      const admin = chance.pickone(accounts);
      const token = await Token.new('Color Token', 'RGB', {from: admin});
      console.debug(`New token contract deployed - address: ${token.address}`);

      // mint initial balances to all accounts
      let balance = 0;
      for(const acct of accounts){
        balance = toBN(1E19).muln(chance.natural({min: 1, max: 100}));
        await token.mint(acct, balance, {from: admin});
      }
      
      const total = await token .totalSupply();
      console.debug(`Total Supply : ${total.toString().toLocaleString()}`);
      
      const loops = 20;
      let delta = 0;
      let sender = null, recipient = null;
      for(let i = 0; i < loops; i++){
        sender = chance.pickone(accounts);
        recipient = chance.pickone(accounts); 
        delta = toBN(1E13).muln(chance.natural({min: 0, max: 100}));
        await token.transfer(recipient, delta, {from: sender});
        
        assert.isTrue((await token.totalSupply()).eq(total),
          "Transfer should not change total supply, but changed.");
      }
    });

    
    it("Should fire 'Transfer' event after transfer.", async() => {
      const chance = new Chance();
      const admin = chance.pickone(accounts);
      const token = await Token.new('Color Token', 'RGB', {from: admin});
      console.debug(`New token contract deployed - address: ${token.address}`);

      // mint initial balances to all accounts
      let balance = 0;
      for(const acct of accounts){
        balance = toBN(1E19).muln(chance.natural({min: 1, max: 100}));
        await token.mint(acct, balance, {from: admin});
      }

      const loops = 20;
      let delta = 0;
      let sender = null, recipient = null;
      for(let i = 0; i < loops; i++){
        sender = chance.pickone(accounts);
        recipient = chance.pickone(accounts);
        delta = toBN(1E13).muln(chance.natural({min: 0, max: 100}));
        await token.transfer(recipient, delta, {from: sender});
        
        expectEvent(await token.transfer(recipient, delta, {from: sender}),
            EventNames.Transfer, {0: sender, 1: recipient, 2: delta.toString()});
      }
    });  
  });


  describe("Approval", () => {
  
    // allowance()
    it("Should setup zero for allowances of all accounts at initial state.", async() => {
      const chance = new Chance();
      const admin = chance.pickone(accounts);
      const token = await Token.new('Color Token', 'RGB', {from: admin});
      console.debug(`New token contract deployed - address: ${token.address}`);

      let allowance = 0;
      for(const owner of accounts){
        for(const spender of accounts){
           allowance = await token.allowance(owner, spender);
           assert.isTrue(allowance.eqn(0), "...");
        }
      }
    });
    
    
    // approve() allowance()
    it("Can appove and inquire allowance to an account for another account.", async() => {
      const chance = new Chance();
      const admin = chance.pickone(accounts);
      const token = await Token.new('Color Token', 'RGB', {from: admin});
      console.debug(`New token contract deployed - address: ${token.address}`);
      
      const loops = 20;
      let owner = null, spender = null;
      let allowance = 0;
      for(let i = 0; i < loops; i++){
        owner = chance.pickone(accounts);
        do{ spender = chance.pickone(accounts); }while(spender == owner)
        allowance = toBN(1E5).muln(chance.natural({min: 1, max: 1000000}));
        
        await token.approve(spender, allowance, {from: owner});
        
        //console.debug(`allowance: ${allowance} = ${await token.allowance(owner, spender)}`);
        assert.isTrue((await token.allowance(owner, spender)).eq(allowance), 
          "Appoval dosen't setup allowance correctly or inquiry dosen't work correctly for address ${owner.substr(0, 10)}");
      }
    });
    

    // approve() allowance()
    it("Can't approve allowance to ZERO account.", async() => {
      const chance = new Chance();
      const admin = chance.pickone(accounts);
      const token = await Token.new('Color Token', 'RGB', {from: admin});
      console.debug(`New token contract deployed - address: ${token.address}`);
      
      let allowance = 0;
      for(const acct of accounts){
        allowance = toBN(1E5).muln(chance.natural({min: 1, max: 1000000}));
        if(chance.bool({ likelihood: 10})) allowance = toBN(0);

        await expectRevert(token.approve('0x0', allowance, {from: acct}), "invalid address");
      }
    });
    

    // approve() allowance()
    it("Can approve allowance oneself, although it seems a little bit silly.", async() => {
      const chance = new Chance();
      const admin = chance.pickone(accounts);
      const token = await Token.new('Color Token', 'RGB', {from: admin});
      console.debug(`New token contract deployed - address: ${token.address}`);
      
      let allowance = 0;
      for(const acct of accounts){
        allowance = toBN(1E5).muln(chance.natural({min: 1, max: 1000000}));
        await token.approve(acct, allowance, {from: acct});
        assert.isTrue((await token.allowance(acct, acct)).eq(allowance), 
          "Appoval dosen't setup allowance correctly or inquiry dosen't work correctly for address ${owner.substr(0, 10)}");
      }
    });


    // approve() allowance()
    it("Can approve zero allowance, although it seems a little bit silly.", async() => {
      const chance = new Chance();
      const admin = chance.pickone(accounts);
      const token = await Token.new('Color Token', 'RGB', {from: admin});
      console.debug(`New token contract deployed - address: ${token.address}`);
      
      const loops = 10;
      let owner = null, spender = null;
      for(let i = 0; i < loops; i++){
        owner = chance.pickone(accounts);
        spender = chance.pickone(accounts);
        
        await token.approve(spender, toBN(0), {from: owner});
        console.debug(`owner: ${owner.substr(0, 10)}, spender: ${spender.substr(0, 10)}`);
        assert.isTrue((await token.allowance(owner, spender)).eqn(0), 
          `Approval 0 allowance for ${owner.substr(0, 10)} to ${spender.substr(0, 10)} doesn't work correctly.`);
      }      
    });
    
    
    // approve()
    it("Shoud fire 'Approval' event after approval.", async() => {
      const chance = new Chance();
      const admin = chance.pickone(accounts);
      const token = await Token.new('Color Token', 'RGB', {from: admin});
      console.debug(`New token contract deployed - address: ${token.address}`);
      
      const loops = 10;
      let owner = null, spender = null;
      let allowance = 0;
      for(let i = 0; i < loops; i++){
        owner = chance.pickone(accounts);
        spender = chance.pickone(accounts);
        allowance = toBN(1E5).muln(chance.natural({min: 1, max: 1000000}));
        if(chance.bool({ likelihood: 10})) allowance = toBN(0);
        
        expectEvent(await token.approve(spender, allowance, {from: owner}),
          EventNames.Approval, {0: owner, 1: spender, 2: allowance.toString()});
      }
    });
    
  });


  describe.only("Delegated Transfer", () => {
    
    // transferFrom()
    it("Should not allow delegated transfer without previous approval.", async() => {
      const chance = new Chance();
      const admin = chance.pickone(accounts);
      const token = await Token.new('Color Token', 'RGB', {from: admin});
      console.debug(`New token contract deployed - address: ${token.address}`);
      
      // mint initial balances to all accounts
      let balance = 0;
      for(const acct of accounts){
        balance = toBN(1E19).muln(chance.natural({min: 1, max: 100}));
        await token.mint(acct, balance, {from: admin});
      }      
      
      // try none-zero transfer without any approval
      const loops = 20;
      let delta = 0;
      let spender = null, recipient = null;
      for(const sender of accounts){
        spender = chance.pickone(accounts);
        recipient = chance.pickone(accounts);
        delta = toBN(1E5).muln(chance.natural({min: 1, max: 100}));
        
        await expectRevert.unspecified(token.transferFrom(sender, recipient, delta, {from: spender}));
      }
    });


    // transferFrom()
    it("Should allow delegated transfer of ZERO amount without previous approval, although it seems a little bit silly.", async() => {
      const chance = new Chance();
      const admin = chance.pickone(accounts);
      const token = await Token.new('Color Token', 'RGB', {from: admin});
      console.debug(`New token contract deployed - address: ${token.address}`);
      
      // mint initial balances to all accounts
      let balance = 0;
      for(const acct of accounts){
        balance = toBN(1E19).muln(chance.natural({min: 1, max: 100}));
        await token.mint(acct, balance, {from: admin});
      }      
      
      // try none-zero transfer without any approval
      const loops = 20;
      let delta = 0;
      let spender = null, recipient = null;
      for(const sender of accounts){
        spender = chance.pickone(accounts);
        recipient = chance.pickone(accounts);
        
        await token.transferFrom(sender, recipient, toBN(0), {from: spender});
      }
    });


    it("Should allow an approved account to transfer instead of the owner within allowance.", async() => {
      // TODO
      
    });


  });


  describe("Burning", () => {


  });

  describe("Circuit Breaker", () => {


  });

});