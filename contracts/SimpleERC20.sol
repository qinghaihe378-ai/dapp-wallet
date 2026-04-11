// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * 教学/自用极简 ERC20：全部初始供应量铸给部署者（msg.sender）。
 * 上线前请自行审计；不保证满足各交易所上币规则。
 */
contract SimpleERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error InsufficientBalance();
    error InsufficientAllowance();

    constructor(string memory name_, string memory symbol_, uint256 initialSupplyWei) {
        name = name_;
        symbol = symbol_;
        totalSupply = initialSupplyWei;
        balanceOf[msg.sender] = initialSupplyWei;
        emit Transfer(address(0), msg.sender, initialSupplyWei);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        uint256 b = balanceOf[msg.sender];
        if (b < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[msg.sender] = b - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a < amount) revert InsufficientAllowance();
        uint256 b = balanceOf[from];
        if (b < amount) revert InsufficientBalance();
        unchecked {
            allowance[from][msg.sender] = a - amount;
            balanceOf[from] = b - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
        return true;
    }
}
