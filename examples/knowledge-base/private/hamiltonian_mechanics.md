# 哈密顿力学与正则方程

哈密顿形式是 [[lagrangian_formalism]] 的等价重写，常用于相空间分析、守恒结构与数值积分。

## 相空间与广义动量

给定广义坐标 $q_i$ 与广义速度 $\dot{q}_i$，定义广义动量：

$$
p_i = \frac{\partial L}{\partial \dot{q}_i}
$$

对可逆情形可作勒让德变换得到哈密顿量：

$$
H(q,p,t) = \sum_i p_i \dot{q}_i - L
$$

## 正则方程

$$
\dot{q}_i = \frac{\partial H}{\partial p_i}, \quad
\dot{p}_i = -\frac{\partial H}{\partial q_i}
$$

该形式天然保持辛结构，适合长期积分与稳定性分析。

## 泊松括号

对相空间函数 $A(q,p), B(q,p)$：

$$
\{A,B\} = \sum_i \left(
\frac{\partial A}{\partial q_i}\frac{\partial B}{\partial p_i} -
\frac{\partial A}{\partial p_i}\frac{\partial B}{\partial q_i}
\right)
$$

若 $\partial A/\partial t = 0$ 且 $\{A,H\}=0$，则 $A$ 为守恒量。

## 工程关联

- 轨迹优化中的共轭变量与边值问题可参见 [[trajectory_optimization]]。
- 连续系统离散化时，推荐使用辛积分思想，见 [[numerical_methods_physics]]。
