# 拉格朗日力学（简介）

拉格朗日形式用**广义坐标** $q_i$ 与**广义速度** $\dot{q}_i$ 描述系统，适合约束多、坐标非笛卡尔的情况。

## 拉格朗日量

定义

$$
L(q, \dot{q}, t) = T - U
$$

其中 $T$ 为动能，$U$ 为势能（可显含时间）。

## 欧拉–拉格朗日方程

对每个广义坐标：

$$
\frac{\mathrm{d}}{\mathrm{d}t}\left(\frac{\partial L}{\partial \dot{q}_i}\right) - \frac{\partial L}{\partial q_i} = 0
$$

无耗散、理想约束时，由此得到与 [[newtonian_mechanics]] 一致的运动方程，但推导往往更简洁。

## 诺特定理（一句话）

拉格朗日量在某连续对称性下不变，则存在对应的守恒量（时间平移→能量，空间平移→动量等）。

## 提示

若系统含电磁场，需用标势 $\phi$ 与矢势 $\vec{A}$ 描写带电粒子，与 [[electromagnetism_maxwell]] 中的势表述一致。
