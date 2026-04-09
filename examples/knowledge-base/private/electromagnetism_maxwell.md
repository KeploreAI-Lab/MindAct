# 电磁学与麦克斯韦方程组（积分形式提要）

## 静电与静磁（真空）

- **高斯电场定律**：$\displaystyle \oint \vec{E}\cdot\mathrm{d}\vec{A} = \frac{Q_\mathrm{enc}}{\varepsilon_0}$
- **高斯磁场定律**：$\displaystyle \oint \vec{B}\cdot\mathrm{d}\vec{A} = 0$（无磁单极）
- **法拉第定律**：$\displaystyle \oint \vec{E}\cdot\mathrm{d}\vec{l} = -\frac{\mathrm{d}\Phi_B}{\mathrm{d}t}$
- **安培–麦克斯韦定律**：$\displaystyle \oint \vec{B}\cdot\mathrm{d}\vec{l} = \mu_0 I_\mathrm{enc} + \mu_0\varepsilon_0 \frac{\mathrm{d}\Phi_E}{\mathrm{d}t}$

$\Phi_B$、$\Phi_E$ 分别为穿过以该回路为边界的曲面的磁通量、电通量。

## 介质中的本构（线性各向同性）

$\vec{D} = \varepsilon \vec{E}$，$\vec{B} = \mu \vec{H}$；界面处有边界条件（切向 $\vec{E}$、法向 $\vec{B}$ 等）。

## 势表述

$\vec{E} = -\nabla\phi - \partial\vec{A}/\partial t$，$\vec{B} = \nabla\times\vec{A}$。带电粒子拉格朗日量见 [[lagrangian_formalism]] 中的提示。

## 与相对论 

麦克斯韦方程在洛伦兹变换下形式不变，自然导向 [[special_relativity_intro]] 中的四维表述（场强张量 $F^{\mu\nu}$）。
