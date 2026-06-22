# 動作庫接入 Free Exercise DB — 策展工作表（WIP）

> 狀態：**校對中，明天繼續更新**。這是「接 Free Exercise DB 真人照進動作庫」功能的 pre-implementation 計畫檔。
> 資料源：[yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db)（Public Domain，873 動作，每動作 2 張真人照 0.jpg=起點 / 1.jpg=終點）。

## 已鎖定決策
- **圖片來源**：真人健身房照片（非 3D 灰人偶風格）；接受。
- **存放**：圖片打包進 app（offline-first），縮 ~600px。
- **縮圖呈現**：動作卡圓圈 → **16:9 長方形卡**（先上）；離線人物偵測置中裁切列 Phase 2。
- **動畫**：2 張圖 `expo-image` crossfade 兩格交替播放（非補間）。
- **數量**：策展常見動作（非全 494）。
- **譯名**：進庫前先批量翻中文（本表）。
- **無 DB 照的動作**：①(c) — 仍建立動作，走 placeholder（圓底首字），日後再補/借圖。
- **自重(bodyweight)**：②確認納入本次匯入。

## 器材對應（Free Exercise DB → TrainingLog 8-enum）
`barbell→槓鈴`、`dumbbell→啞鈴`、`kettlebells→壺鈴`、`cable→滑輪`、`machine→固定機械`、`body only/other(自重類)→自重`；名字含 `Smith`→`史密斯機`。**地雷管放棄**（DB 無分類＋enum 無此值）。

## 清單總覽：155 個（142 有真照 / 13 placeholder）
各部位：胸 30、背 30、肩 21、斜方 5、二頭 12、三頭 12、小臂 1、腿 25、臀 6、小腿 6、核心 7

### 【胸】（30）
| 中文名 | 器材 | 圖 | 英文 / 備註 |
|---|---|---|---|
| 史密斯臥推 | 史密斯機 | 📷 | Smith Machine Bench Press |
| 史密斯上斜臥推 | 史密斯機 | 📷 | Smith Machine Incline Bench Press |
| 啞鈴臥推 | 啞鈴 | 📷 | Dumbbell Bench Press |
| 上斜啞鈴臥推 | 啞鈴 | 📷 | Incline Dumbbell Press |
| 下斜啞鈴臥推 | 啞鈴 | 📷 | Decline Dumbbell Bench Press |
| 啞鈴飛鳥 | 啞鈴 | 📷 | Dumbbell Flyes |
| 上斜啞鈴飛鳥 | 啞鈴 | 📷 | Incline Dumbbell Flyes |
| 啞鈴仰臥拉舉 | 啞鈴 | 📷 | Bent-Arm Dumbbell Pullover |
| 機械臥推 | 固定機械 | 📷 | Machine Bench Press |
| 蝴蝶機夾胸 | 固定機械 | 📷 | Butterfly |
| 坐姿機械推胸（上胸） | 固定機械 | 📷 | Leverage Incline Chest Press |
| 坐姿機械推胸（下胸） | 固定機械 | 📷 | Leverage Decline Chest Press |
| 坐姿機械推胸（平胸） | 固定機械 | 📷 | Leverage Chest Press |
| 壺鈴地板臥推 | 壺鈴 | 📷 | One-Arm Kettlebell Floor Press |
| 槓鈴臥推 | 槓鈴 | 📷 | Barbell Bench Press - Medium Grip |
| 上斜槓鈴臥推 | 槓鈴 | 📷 | Barbell Incline Bench Press - Medium Grip |
| 下斜槓鈴臥推 | 槓鈴 | 📷 | Decline Barbell Bench Press |
| 架上臥推 | 槓鈴 | 📷 | Pin Presses |
| 滑輪夾胸 | 滑輪 | 📷 | Cable Crossover |
| 低位滑輪夾胸 | 滑輪 | 📷 | Low Cable Crossover |
| 站姿滑輪推胸 | 滑輪 | 📷 | Standing Cable Chest Press |
| 單側滑輪夾胸 | 滑輪 | 📷 | Single-Arm Cable Crossover |
| 雙槓臂屈伸（自重） | 自重 | 📷 | Dips - Chest Version |
| 伏地挺身 | 自重 | 📷 | Pushups |
| 伏地挺身（上斜） | 自重 | 📷 | Incline Push-Up |
| 伏地挺身（下斜） | 自重 | 📷 | Decline Push-Up |
| 蝴蝶機夾胸（上胸） | 固定機械 | ⬚placeholder | DB無上斜蝴蝶機；近似上斜飛鳥 |
| 暫停臥推 | 槓鈴 | ⬚placeholder | DB無paused；近似槓鈴臥推 |
| 雙槓臂屈伸（輔助） | 自重 | ⬚placeholder | DB無輔助雙槓；近似Dip Machine |
| 雙槓臂屈伸（負重） | 自重 | ⬚placeholder | DB無負重雙槓；近似自重雙槓 |

### 【背】（30）
| 中文名 | 器材 | 圖 | 英文 / 備註 |
|---|---|---|---|
| 史密斯划船 | 史密斯機 | 📷 | Smith Machine Bent Over Row |
| 單臂啞鈴划船 | 啞鈴 | 📷 | One-Arm Dumbbell Row |
| 啞鈴划船 | 啞鈴 | 📷 | Bent Over Two-Dumbbell Row |
| 機械高位划船 | 固定機械 | 📷 | Leverage High Row |
| 機械坐姿划船 | 固定機械 | 📷 | Leverage Iso Row |
| 單臂壺鈴划船 | 壺鈴 | 📷 | One-Arm Kettlebell Row |
| 架上拉 | 槓鈴 | 📷 | Rack Pulls |
| 槓鈴划船 | 槓鈴 | 📷 | Bent Over Barbell Row |
| 反握划船 | 槓鈴 | 📷 | Reverse Grip Bent-Over Rows |
| T槓划船 | 槓鈴 | 📷 | T-Bar Row with Handle |
| 槓鈴仰臥拉舉 | 槓鈴 | 📷 | Bent-Arm Barbell Pullover |
| 寬握滑輪下拉 | 滑輪 | 📷 | Wide-Grip Lat Pulldown |
| 窄握滑輪下拉 | 滑輪 | 📷 | Close-Grip Front Lat Pulldown |
| V 把下拉 | 滑輪 | 📷 | V-Bar Pulldown |
| 反握滑輪下拉 | 滑輪 | 📷 | Underhand Cable Pulldowns |
| 直臂下壓 | 滑輪 | 📷 | Straight-Arm Pulldown |
| 坐姿划船 | 滑輪 | 📷 | Seated Cable Rows |
| 單臂坐姿滑輪划船 | 滑輪 | 📷 | Seated One-arm Cable Pulley Rows |
| 引體向上（自重） ·bodyweight | 自重 | 📷 | Pullups |
| 引體向上（輔助） ·assisted | 自重 | 📷 | Band Assisted Pull-Up |
| 引體向上（負重） | 自重 | 📷 | Weighted Pull Ups |
| 機械高位划船（反握） | 固定機械 | ⬚placeholder | DB無反握變體；近似機械高位划船 |
| 機械單側高位划船 | 固定機械 | ⬚placeholder | DB無機械單側高位；近似跪姿單臂高位滑輪划船 |
| 機械單側高位划船（反握） | 固定機械 | ⬚placeholder | 同上+反握 |
| 機械單側划船 | 固定機械 | ⬚placeholder | DB無機械單側；近似單臂啞鈴划船 |
| 潘德雷划船 | 槓鈴 | ⬚placeholder | DB無pendlay；近似槓鈴划船 |
| 六角槓划船 | 槓鈴 | ⬚placeholder | DB無六角槓划船；近似槓鈴划船 |
| 對握滑輪下拉 | 滑輪 | ⬚placeholder | 重疊V把下拉；近似V-Bar Pulldown |
| 單臂直臂下壓 | 滑輪 | ⬚placeholder | DB無單臂；近似直臂下壓 |
| 坐姿划船（寬握） | 滑輪 | ⬚placeholder | DB無寬握變體；近似坐姿划船 |

### 【肩】（21）
| 中文名 | 器材 | 圖 | 英文 / 備註 |
|---|---|---|---|
| 史密斯肩推 | 史密斯機 | 📷 | Smith Machine Overhead Shoulder Press |
| 啞鈴肩推 | 啞鈴 | 📷 | Dumbbell Shoulder Press |
| 坐姿啞鈴肩推 | 啞鈴 | 📷 | Seated Dumbbell Press |
| 阿諾肩推 | 啞鈴 | 📷 | Arnold Dumbbell Press |
| 啞鈴側平舉 | 啞鈴 | 📷 | Side Lateral Raise |
| 啞鈴前平舉 | 啞鈴 | 📷 | Front Dumbbell Raise |
| 俯身後束飛鳥 | 啞鈴 | 📷 | Reverse Flyes |
| 機械肩推 | 固定機械 | 📷 | Machine Shoulder (Military) Press |
| 反向蝴蝶機後束 | 固定機械 | 📷 | Reverse Machine Flyes |
| 壺鈴肩推 | 壺鈴 | 📷 | Two-Arm Kettlebell Military Press |
| 壺鈴抓舉 | 壺鈴 | 📷 | One-Arm Kettlebell Snatch |
| 壺鈴推蹲 | 壺鈴 | 📷 | Kettlebell Thruster |
| 土耳其起立 | 壺鈴 | 📷 | Kettlebell Turkish Get-Up (Squat style) |
| 槓鈴肩推 | 槓鈴 | 📷 | Barbell Shoulder Press |
| 坐姿槓鈴肩推 | 槓鈴 | 📷 | Seated Barbell Military Press |
| 站姿軍事推舉 | 槓鈴 | 📷 | Standing Military Press |
| 借力推 | 槓鈴 | 📷 | Push Press |
| 槓鈴直立划船 | 槓鈴 | 📷 | Upright Barbell Row |
| 面拉 | 滑輪 | 📷 | Face Pull |
| 滑輪後束飛鳥 | 滑輪 | 📷 | Cable Rear Delt Fly |
| 坐姿滑輪側平舉 | 滑輪 | 📷 | Cable Seated Lateral Raise |

### 【斜方】（5）
| 中文名 | 器材 | 圖 | 英文 / 備註 |
|---|---|---|---|
| 史密斯直立划船 | 史密斯機 | 📷 | Smith Machine Upright Row |
| 啞鈴聳肩 | 啞鈴 | 📷 | Dumbbell Shrug |
| 槓鈴聳肩 | 槓鈴 | 📷 | Barbell Shrug |
| 滑輪直立划船 | 滑輪 | 📷 | Upright Cable Row |
| 滑輪聳肩 | 滑輪 | 📷 | Cable Shrugs |

### 【二頭】（12）
| 中文名 | 器材 | 圖 | 英文 / 備註 |
|---|---|---|---|
| 啞鈴彎舉 | 啞鈴 | 📷 | Dumbbell Bicep Curl |
| 錘式彎舉 | 啞鈴 | 📷 | Hammer Curls |
| 上斜啞鈴彎舉 | 啞鈴 | 📷 | Incline Dumbbell Curl |
| 集中彎舉 | 啞鈴 | 📷 | Concentration Curls |
| Zottman 彎舉 | 啞鈴 | 📷 | Zottman Curl |
| 機械二頭彎舉 | 固定機械 | 📷 | Machine Bicep Curl |
| 槓鈴彎舉 | 槓鈴 | 📷 | Barbell Curl |
| 牧師彎舉 | 槓鈴 | 📷 | Preacher Curl |
| 反握槓鈴彎舉 | 槓鈴 | 📷 | Reverse Barbell Curl |
| 滑輪二頭彎舉 | 滑輪 | 📷 | Standing Biceps Cable Curl |
| 繩索錘式彎舉 | 滑輪 | 📷 | Cable Hammer Curls - Rope Attachment |
| 滑輪牧師彎舉 | 滑輪 | 📷 | Cable Preacher Curl |

### 【三頭】（12）
| 中文名 | 器材 | 圖 | 英文 / 備註 |
|---|---|---|---|
| 史密斯窄握臥推 | 史密斯機 | 📷 | Smith Machine Close-Grip Bench Press |
| 臥姿啞鈴三頭伸展 | 啞鈴 | 📷 | Lying Dumbbell Tricep Extension |
| 站姿過頭啞鈴三頭伸展 | 啞鈴 | 📷 | Standing Dumbbell Triceps Extension |
| 啞鈴三頭後屈伸 | 啞鈴 | 📷 | Tricep Dumbbell Kickback |
| 坐姿啞鈴三頭推 | 啞鈴 | 📷 | Seated Triceps Press |
| 機械三頭伸展 | 固定機械 | 📷 | Machine Triceps Extension |
| 機械臂屈伸 | 固定機械 | 📷 | Dip Machine |
| 窄握槓鈴臥推 | 槓鈴 | 📷 | Close-Grip Barbell Bench Press |
| 槓鈴顱骨粉碎 | 槓鈴 | 📷 | Lying Close-Grip Barbell Triceps Extension Behind The Head |
| 三頭下壓 | 滑輪 | 📷 | Triceps Pushdown |
| 繩索三頭下壓 | 滑輪 | 📷 | Triceps Pushdown - Rope Attachment |
| 繩索過頭三頭伸展 | 滑輪 | 📷 | Cable Rope Overhead Triceps Extension |

### 【小臂】（1）
| 中文名 | 器材 | 圖 | 英文 / 備註 |
|---|---|---|---|
| 坐姿槓鈴腕彎舉 | 槓鈴 | 📷 | Seated Palm-Up Barbell Wrist Curl |

### 【腿】（25）
| 中文名 | 器材 | 圖 | 英文 / 備註 |
|---|---|---|---|
| 史密斯深蹲 | 史密斯機 | 📷 | Smith Machine Squat |
| 啞鈴深蹲 | 啞鈴 | 📷 | Dumbbell Squat |
| 啞鈴弓步蹲 | 啞鈴 | 📷 | Dumbbell Lunges |
| 啞鈴登階 | 啞鈴 | 📷 | Dumbbell Step Ups |
| 相撲啞鈴深蹲 | 啞鈴 | 📷 | Plie Dumbbell Squat |
| 啞鈴分腿蹲 | 啞鈴 | 📷 | Split Squat with Dumbbells |
| 啞鈴直腿硬舉 | 啞鈴 | 📷 | Stiff-Legged Dumbbell Deadlift |
| 腿推 | 固定機械 | 📷 | Leg Press |
| 坐姿腿伸展 | 固定機械 | 📷 | Leg Extensions |
| 哈克深蹲 | 固定機械 | 📷 | Hack Squat |
| 俯臥腿彎舉 | 固定機械 | 📷 | Lying Leg Curls |
| 坐姿腿彎舉 | 固定機械 | 📷 | Seated Leg Curl |
| 壺鈴擺盪 | 壺鈴 | 📷 | One-Arm Kettlebell Swings |
| 高腳杯深蹲 | 壺鈴 | 📷 | Goblet Squat |
| 雙壺鈴前蹲 | 壺鈴 | 📷 | Front Squats With Two Kettlebells |
| 壺鈴單腿硬舉 | 壺鈴 | 📷 | Kettlebell One-Legged Deadlift |
| 壺鈴上膊 | 壺鈴 | 📷 | One-Arm Kettlebell Clean |
| 槓鈴深蹲 | 槓鈴 | 📷 | Barbell Squat |
| 槓鈴前蹲 | 槓鈴 | 📷 | Front Barbell Squat |
| 槓鈴弓步蹲 | 槓鈴 | 📷 | Barbell Lunge |
| 槓鈴硬舉 | 槓鈴 | 📷 | Barbell Deadlift |
| 羅馬尼亞硬舉 | 槓鈴 | 📷 | Romanian Deadlift |
| 相撲硬舉 | 槓鈴 | 📷 | Sumo Deadlift |
| 直腿硬舉 | 槓鈴 | 📷 | Stiff-Legged Barbell Deadlift |
| 早安式體前屈 | 槓鈴 | 📷 | Good Morning |

### 【臀】（6）
| 中文名 | 器材 | 圖 | 英文 / 備註 |
|---|---|---|---|
| 大腿外展機 | 固定機械 | 📷 | Thigh Abductor |
| 大腿內收機 | 固定機械 | 📷 | Thigh Adductor |
| 槓鈴臀推 | 槓鈴 | 📷 | Barbell Hip Thrust |
| 槓鈴臀橋 | 槓鈴 | 📷 | Barbell Glute Bridge |
| 滑輪前後拉 | 滑輪 | 📷 | Pull Through |
| 滑輪後踢腿 | 滑輪 | 📷 | One-Legged Cable Kickback |

### 【小腿】（6）
| 中文名 | 器材 | 圖 | 英文 / 備註 |
|---|---|---|---|
| 史密斯提踵 | 史密斯機 | 📷 | Smith Machine Calf Raise |
| 站姿啞鈴提踵 | 啞鈴 | 📷 | Standing Dumbbell Calf Raise |
| 坐姿提踵 | 固定機械 | 📷 | Seated Calf Raise |
| 站姿提踵 | 固定機械 | 📷 | Standing Calf Raises |
| 機械蹬式提踵 | 固定機械 | 📷 | Calf Press |
| 站姿槓鈴提踵 | 槓鈴 | 📷 | Standing Barbell Calf Raise |

### 【核心】（7）
| 中文名 | 器材 | 圖 | 英文 / 備註 |
|---|---|---|---|
| 啞鈴體側屈 | 啞鈴 | 📷 | Dumbbell Side Bend |
| 機械捲腹 | 固定機械 | 📷 | Ab Crunch Machine |
| 壺鈴風車 | 壺鈴 | 📷 | Kettlebell Windmill |
| 槓鈴滾輪捲腹 | 槓鈴 | 📷 | Barbell Ab Rollout |
| 滑輪跪姿捲腹 | 滑輪 | 📷 | Cable Crunch |
| 帕洛夫推 | 滑輪 | 📷 | Pallof Press |
| 滑輪砍柴 | 滑輪 | 📷 | Standing Cable Wood Chop |

## 明天 TODO
1. 完成各部位譯名校對（胸/背已收一批增改；其餘部位待使用者過目）。
2. 校對定案後：下載 142 個 real 的 2 圖 → 縮 600px → `assets/exercise-media/{id}/0.jpg,1.jpg`。
3. 產生靜態 `require` map（Metro 不能動態 require）。
4. 新 seed migration vNNN 灌 155 動作（含 placeholder 13 個 media_path=NULL）。
5. ADR-0017 amend：媒體灌入 + 卡形改 16:9 + 2 格交替播放；動作卡/詳情頁 wire。
6. 註：`小臂` 僅 1 個（DB 前臂動作少），待補；ADR-0010 細分肌群（胸上下/二頭內外）DB 不標，seed 手動補。
