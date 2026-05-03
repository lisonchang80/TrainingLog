# 0001 — Exercise 變體即獨立 Exercise

每個器械變體（例：平板槓鈴臥推、上斜啞鈴臥推、史密斯臥推）建模為**獨立的 Exercise row**，
而不是一個「臥推」Exercise + variant/equipment 屬性欄位。

理由：使用者在這些變體上的工作重量差異顯著，PR 與進步追蹤必須分開計算才有意義；
若合併為單一 Exercise + variant 屬性，PR 圖會把不同重量等級的數據混為一條曲線，喪失分析價值。
代價是內建動作表 row 數較多（預期 60–80 個），但這是 SQL JOIN 友善的扁平結構，可接受。

—— 拒絕的替代方案：「Exercise (臥推) + variant 屬性 (平板/上斜/史密斯)」。
原因：把變體當屬性會強制 PR 查詢 GROUP BY (exercise_id, variant)，而 variant 又只在某些 Exercise 上有意義（深蹲有變體、彎舉幾乎沒有），schema 變成稀疏 + 條件邏輯，不值得。
