# 控制与动力学建模

控制系统通常建立在状态空间模型上，并与 [[newtonian_mechanics]] 或 [[hamiltonian_mechanics]] 提供的动力学方程结合。

## 状态空间模型

$$
\dot{x} = f(x,u,t), \quad y = h(x,u,t)
$$

线性化后：

$$
\dot{x}=Ax+Bu, \quad y=Cx+Du
$$

## 稳定性与性能

- 渐近稳定、李雅普诺夫稳定
- 调节时间、超调量、稳态误差
- 鲁棒性与抗扰能力

## 常见方法

- PID（低成本、易落地）
- LQR/LQG（线性二次最优）
- MPC（约束优化控制）

## 工程关联

- 约束控制与滚动优化可接入 [[trajectory_optimization]]。
- 离散实现与滤波器设计见 [[signal_and_systems]]。
