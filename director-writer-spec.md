# Director–Writer — Bản chốt thiết kế

Ngày chốt: 2026-08-15. Chưa viết code.

## Mục tiêu

Tách một lượt RP thành hai model. Director đọc toàn bộ ngữ cảnh rồi xuất một packet cô đặc.
Writer chỉ nhận packet đó rồi viết ra phản hồi RP. Mục tiêu là chất lượng văn và khả năng
đổi Writer để so sánh, **không phải tiết kiệm tiền** — xem mục Chi phí.

## Nguyên tắc

1. Không dựng thêm mặt cấu hình song song. Mọi thứ khác nhau giữa Director và Writer đều
   nằm trong preset sẵn có.
2. **Đọc preset như dữ liệu, không apply preset.** Không gọi `changeToPreset`. Lý do ở mục
   Hazard.
3. FACT tách khỏi DIRECTION. Director được nói chuyện sắp xảy ra chỉ trong đúng một mục.
4. Ràng buộc cứng phải lặp lại ở tầng Writer, không tin nó theo packet đi xuống.

## Cấu hình

### Toàn cục — 3 thứ

- Nút bật/tắt tính năng
- Dropdown chọn preset Director
- Dropdown chọn preset Writer

Dropdown chỉ liệt kê preset có tick vai tương ứng. Không preset nào tick thì danh sách rỗng.

### Trong từng preset

- Tick vai: Director **hoặc** Writer. Loại trừ nhau — tick cái này thì cái kia ẩn.
- Tick rồi mới hiện ô prompt vai của nó, để xem và sửa.
- Preset Director hiện thêm bảng schema packet. Preset Writer không có bảng này.
- Preset không tick gì thì không thấy gì cả — preset cũ của mọi người không đổi.

Không thêm field nào vào trang setting chung. Không thêm CBS mới.

### Prebuilt

Ship sẵn hai preset mẫu tên `Director` và `Writer` trong `prebuiltPresets`
(`src/ts/process/templates/templates.ts:5`), đã tick vai, đã có prompt và schema mặc định.
Bật tính năng lên là chọn dùng liền.

## Bảng schema packet — chỉ ở preset Director

Danh sách dòng, kéo thả sắp thứ tự. Thứ tự dòng là thứ tự header trong packet.
Mỗi dòng ba thứ:

- **Tên header** — user chỉ gõ tên, code tự thêm dấu `[ ]`
- **Mô tả** — Director phải trả gì cho mục này
- **Tick bắt buộc** — dùng cho validate

Danh sách này vừa là hướng dẫn cho Director vừa là luật validate — một nguồn, không lệch nhau.
`[WRITING STYLE]` là contract bắt buộc của pipeline: schema cũ hoặc custom schema thiếu dòng này
được tự chèn trước `[DIRECTION]`/`[OUTPUT LANGUAGE]`, hoặc ở cuối nếu không có hai dòng đó. Row
`[WRITING STYLE]` đã tồn tại từ version cũ cũng luôn được thay bằng description canonical hiện tại;
đây là row do pipeline sở hữu, tránh preset cũ giữ luật `BASE: ...` mâu thuẫn với validator mới.

### 9 header mặc định

| Header | Bắt buộc | Nội dung |
|---|---|---|
| `[SITUATION]` | có | Trạng thái cảnh hiện tại do history thiết lập: ở đâu, lúc nào, ai có mặt và vị trí cần thiết |
| `[FACTS]` | có | Chỉ sự kiện, lời hứa, knowledge và thread phụ thuộc history cần cho lượt này |
| `[CHARACTER]` | có | State tạm thời đang active do history: cảm xúc, mục tiêu, thái độ và condition hiện tại |
| `[WRITING STYLE]` | có | Baseline văn phong: Writer gần nhất, nếu chưa có thì greeting, nếu cả hai không có thì NONE; chỉ ghi đặc điểm quan sát được và override style explicit từ user |
| `[DIRECTION]` | có | Ý đồ kịch của lượt này — mục duy nhất được nói chuyện chưa xảy ra |
| `[OUTPUT LANGUAGE]` | có | Ngôn ngữ Writer phải viết |
| `[FORBIDDEN]` | không | Không điều khiển nhân vật user, chưa được hòa giải, chưa tiết lộ X |
| `[OMITTED]` | không | Director tự khai nó đã bỏ những gì khi nén |
| `[LAST TURN NOTES]` | không | Lỗi Writer mắc ở lượt trước — xem mục Sửa Writer |

`[SITUATION]`, `[FACTS]`, `[CHARACTER]` là FACT. `[DIRECTION]` là DIRECTION. `[FORBIDDEN]` là chặn.

`[WRITING STYLE]` luôn bắt đầu bằng đúng một trong ba câu văn xuôi: `The writing style baseline is
the previous Writer reply.`, `The writing style baseline is the greeting.`, hoặc `There is no
writing style baseline.` Thứ tự ưu tiên baseline:

1. Phản hồi gần nhất do Writer của pipeline sinh ra và vẫn còn bật trong history của nhân vật đó.
2. Greeting/first message đang được chọn, chỉ khi chưa có phản hồi Writer.
3. Không có cả hai thì `NONE`; Writer tự chọn văn phong.

Director chỉ được phổ cập những đặc điểm văn xuôi quan sát trực tiếp từ baseline: độ dài gần đúng,
mật độ, nhịp đoạn, tỷ lệ kể/thoại, POV/thì, tone, texture câu và mật độ giác quan. Timestamp, format
nhãn thoại, sound marker, gloss/annotation, HTML/custom tag, vị trí ảnh và asset key là rendering
protocol chứ không phải prose style; chúng không được đưa vào packet. Writer lấy các luật đó trực tiếp
từ preset đang active, Jainreack và output protocol authoritative. Greeting vẫn là canon của cảnh
nhưng ngừng làm nguồn style ngay khi đã có phản hồi Writer.

Nếu tin user mới nhất yêu cầu rõ một thay đổi về độ dài, tone, POV, format hoặc cách đặt media,
Director mô tả yêu cầu đó bằng một câu văn hoàn chỉnh và chỉ đổi đúng chiều được yêu cầu; các chiều
còn lại tiếp tục theo baseline. Nội dung diễn biến bình thường không được coi là yêu cầu style. Director cấm phê
bình, “cải thiện”, hoặc thêm gu riêng từ card, history khác, thể loại hay sở thích của chính nó.

### Quy tắc nội dung packet

- Nội dung scene fact, character state và direction ưu tiên câu văn xuôi ngắn để Writer nhỏ không
  bắt chước punctuation của ghi chú. Đây không phải validation cấm ký hiệu: packet lỡ còn bullet,
  ngoặc, tag hay markup vẫn pass. Tuy nhiên Director không được biến chúng thành style/direction,
  còn Writer được nhắc rằng mọi punctuation và syntax trong packet chỉ là context; format output chỉ
  đến từ output-protocol context của preset active đã được giữ nguyên.
- Nhãn và toàn bộ lời mô tả/chỉ dẫn trong packet viết tiếng Anh. Nội dung trích dẫn **giữ nguyên
  ngôn ngữ gốc**, không dịch. Packet bị localize sẽ fail validation và Director phải retry.
- Tên riêng, câu trích nguyên văn, vị trí, ai đang biết chuyện gì — ghi y nguyên, cấm diễn giải.
  Đây là thứ vỡ đầu tiên khi nén.
- Character card và voice instruction đi thẳng sang Writer. Director chỉ ghi state, emotion, goal hoặc
  attitude đang được history kích hoạt hay thay đổi; không tóm tắt lại toàn bộ card.
- `[DIRECTION]` ghi ý đồ, **không** storyboard từng câu. Chi tiết quá thì Writer thành máy
  paraphrase và mất hết lợi ích.
- Tin nhắn user **không** nằm trong packet. Nó được gửi riêng như một message role user thật.
- Không tự đặt độ dài mong muốn mới. `[WRITING STYLE]` được ghi độ dài gần đúng đã quan sát từ
  baseline, hoặc độ dài user vừa yêu cầu; `maxResponse` của preset Writer vẫn là trần kỹ thuật.

## Prompt gửi cho Writer

Writer nhận toàn bộ prompt đã render của preset đang hoạt động, chỉ bỏ message thuộc chat history.
Packet thay history bằng continuity hiện tại và hướng kịch bản:

```
system: <prompt vai Writer>
...:    <character + persona + lore/world + memory + author note + preset/output protocols>
system: <packet>
user:   <nguyên văn tin nhắn user>
```

Image syntax, asset key, số lượng và vị trí ảnh chỉ đến từ prompt/config đã render của preset active.
Pipeline không tự phát hiện, viết lại hoặc chèn thêm một image protocol thứ hai sau packet.

Auto-strip khi preset có tick Writer — app tự bỏ, user không phải dựng template trống:

- **Bỏ**: chỉ các message chat history đã được đánh dấu `removable`
- **Giữ**: character card, persona, lorebook/world, memory, author note, jailbreak, POV/agency,
  timestamp/speaker/markup/image protocol và các cấu hình còn lại của preset

Director vì vậy không cần chép lại dữ liệu tĩnh. `[SITUATION]`, `[FACTS]` và `[CHARACTER]` chỉ chuyển
phần continuity phụ thuộc history; trọng tâm của packet là state hiện tại và `[DIRECTION]`.

Director luôn gọi provider ở chế độ non-streaming. Trong lúc chờ, UI chỉ hiện trạng thái đang chỉ đạo;
nút Stop hủy request qua `AbortController`. Khi Director hoàn tất, chỉ packet đã normalize và validate
từ final response nằm ngoài `<Thoughts>`, `<think>` hoặc `<analysis>` mới được chuyển cho Writer. Packet
nằm trong reasoning, kể cả đủ header, không bao giờ được cứu hộ; reasoning bị cắt trước closing tag được
bỏ đến EOF rồi Director retry.

## Prompt cho Director

Nói rõ: không RP, không viết thoại trừ khi cần trích nguyên văn, không nhại nhân vật, không viết
phản hồi cuối. Chỉ phân tích trạng thái và xuất packet.

Prompt đã dựng từ preset đang hoạt động vẫn được truyền đủ, nhưng được serialize vào
`DIRECTOR_SOURCE_CONTEXT` như dữ liệu quote thay vì giữ quyền `system/user/assistant` thật. Contract
Director đứng ở system đầu tiên và một final command đứng sau source. Việc cách ly này ngăn main
prompt, jailbreak, image instruction hay lời RP trong context biến Director thành Writer, đúng lỗi
đã quan sát khi DeepSeek bỏ toàn bộ schema và trả thẳng roleplay ở cả hai attempt.

Nếu không nói rõ, Director sẽ viết một đoạn RP rồi Writer chỉ paraphrase lại — mất sạch lý do
dùng hai model.

## Validate packet

Không parse. Chỉ đếm header.

- Thiếu bất kỳ header có tick bắt buộc → fail
- Không tick cái nào bắt buộc → vẫn đòi ít nhất một header bất kỳ (sàn tối thiểu)
- Fail → retry Director **một** lần → vẫn fail thì báo lỗi để user reroll

Không tự động rơi về một-model. Rơi âm thầm thì user nhận văn kém mà không hiểu vì sao.

Ca mà sàn một-header bắt được chính là ca tệ nhất: Director viết RP thay vì viết packet — lúc đó
nó ra 0 header.

## Lưu packet

Lưu theo từng tin nhắn, chỗ đang lưu tên preset và số token
(`MessageGenerationInfo`, `src/ts/storage/database.svelte.ts:1862`). **Luôn lưu**, không phụ thuộc
setting hiện prompt info — lưu và hiện là hai chuyện tách nhau.

Lưu kèm:

- Hash của **prefix history** mà Director đã đọc — chỉ role và nội dung của tin đang bật.
  Không tính bản dịch cache hay text đã qua regex, không thì hash đổi vì lý do vô nghĩa.
- Tên preset Director và Writer lúc đó
- Hash prompt Director và hash schema lúc đó

Chỉ giữ packet của khoảng vài chục tin gần nhất, cũ hơn thì dọn. Director không đọc packet cũ,
giữ mãi chỉ làm phồng file save và chậm sync.

## Hai luật bất biến

Thay vì liệt kê ngoại lệ rồi xử từng cái, chỉ có hai luật:

**Luật 1** — Packet chỉ hợp lệ khi hash prefix khớp **và** tên hai preset khớp. Không hợp lệ,
hoặc không có packet, thì gọi Director. Không báo lỗi, không đoán.

**Luật 2** — Chỉ có đúng hai đường được dùng packet cũ: reroll ở chế độ Writer-only, và continue.
Mọi đường khác luôn gọi Director mới.

Ngoại lệ duy nhất: **continue bỏ qua kiểm tra hash.** Không có ngoại lệ này thì auto-continue sẽ
gọi Director thêm một lần mỗi khi câu bị cắt giữa dòng.

## Các ca cụ thể tự rơi vào hai luật

| Ca | Xử lý |
|---|---|
| Tắt tính năng, chơi vài lượt, bật lại | Ổn. Director đọc history thật, không đọc chuỗi packet |
| Reroll tin sinh ra lúc tính năng đang tắt | Không có packet → Luật 1 → gọi Director |
| Xóa mấy tin mới rồi reroll tin cũ | Prefix không đổi → packet vẫn dùng được → reroll rẻ |
| Swipe sang bản khác của tin ở giữa | Prefix đổi → gọi Director |
| Xóa hoặc tắt tin nhắn ở giữa | Prefix đổi → gọi Director |
| Đổi sang greeting khác (`fmIndex`) | Prefix đổi → gọi Director |
| Tạo nhánh chat mới | Packet nằm trong tin nhắn nên copy theo, prefix giống → dùng được |
| Đổi preset Director hoặc Writer giữa chat | Tên preset khác → Luật 1 → gọi Director |
| Group chat | Mỗi nhân vật prefix riêng → tự tách |
| User sửa tay tin nhắn | Prefix đổi → **buộc** gọi Director, không cho tùy chọn |

Ca cuối là quan trọng nhất: user sửa tin nhắn là để lái diễn biến, mà reroll với packet cũ thì
Writer diễn lại đúng chỉ đạo cũ, tức chống lại chính cái user vừa sửa.

Dùng hash thay vì hook từng chỗ sửa tin nhắn, vì Risu có nhiều đường mutate message (UI edit,
xóa, swipe, trigger, script) — hook hết kiểu gì cũng sót một cái rồi sinh bug im lặng.

## Reroll

Một ô chọn trong khối setting: reroll chạy lại cả Director, hay chỉ Writer. **Mặc định chỉ Writer.**

Chế độ chỉ-Writer là "cùng chỉ đạo, diễn lại cách khác" — đúng cái user muốn khi họ chỉ không thích
văn. Các bản reroll dùng chung một packet nên swipe qua lại vẫn nhất quán về diễn biến.

Chế độ chạy lại cả Director phải ghi rõ trong tên option là tốn thêm tiền.

## Sửa Writer qua packet

Director vốn đã đọc full history nên nó **đã thấy** bài Writer viết lượt trước. Không cần call nào
thêm — nó ghi nhận xét vào `[LAST TURN NOTES]` của packet lượt sau. Sửa hướng về phía trước, không
phải chấm lại rồi viết lại như mấy bản khác đang làm.

Luật bắt buộc: Director chỉ được sửa **vi phạm**, cấm sửa **thẩm mỹ**.

- Được: để nhân vật nói thay user, trái một fact đã có, mất giọng đã khai, lặp y nguyên câu mở đầu
- Cấm: "văn chưa đẹp", "chưa đủ cảm xúc" — đó là gu, mà gu Director chưa chắc là gu user

Không có lỗi thì để trống, cấm cố tìm cho có. Lượt nào cũng bị nhắc thì Writer viết kiểu phòng thân
và khô đi.

## Cadence

Director chạy **mỗi lượt**. Không có ngưỡng, không có packet phân tầng, không có cấu hình tần suất.
Chuyện tốn kém để user tự lo.

Hệ quả tốt: packet không bao giờ stale, nên hash prefix chỉ còn phục vụ đúng ca reroll.

## Trigger, abort, preview

- Trigger loại `request` (`src/ts/process/request/request.ts:249`) **chỉ chạy cho Writer.**
  Nếu chạy cả hai thì script user chạy hai lần mỗi lượt, lần đầu nhận prompt Director — script
  regex sẽ làm hỏng prompt Director, script đếm sẽ đếm gấp đôi.
- User bấm stop lúc Director đang chạy → **chặn luôn**, không được chạy tiếp sang Writer.
- Director lỗi mạng hoặc API chết → báo lỗi và dừng, khác với fail validate. Risu đã có
  `fallbackModels` riêng cho từng loại call nên phần này gần như tự lo.
- **Director không chạy trên preview và dry-run.** Extension Tracker của SillyTavern đã ăn đúng bug
  này: dry-run lúc mở lại chat cũ bị coi là tin nhắn mới rồi gọi model tốn tiền.
- Preview prompt (DevTool) chỉ hiện phía Director. Prompt Writer không dựng được nếu chưa có packet,
  mà muốn có packet thì phải gọi Director thật — trái tinh thần preview. Muốn xem prompt Writer thì
  chat một lượt rồi coi trong prompt info.

## Group chat

Giữ nguyên cách hiện tại, mỗi nhân vật một lượt riêng và một Director riêng. Nhóm 4 người là 4 lần
Director cho một tin nhắn user.

Đắt nhưng đúng — mỗi nhân vật cần chỉ đạo riêng vì tính cách khác, biết chuyện khác, thái độ với
user khác. Risu chạy tuần tự nên tới nhân vật thứ hai thì câu của nhân vật thứ nhất đã nằm trong
history, Director thấy được luôn. Tự khớp, không phải làm gì.

## Chat mới

Director dựa vào tin nhắn user mà chỉ đạo. User không nói gì thì nó tự phát sinh một bối cảnh,
tình huống mở đầu hợp lý.

Lưu ý: chat Risu thường vẫn có first message của nhân vật nên "trắng hoàn toàn" khá ít khi xảy ra.
Có greeting thì Director phải dựa vào đó, cấm dựng bối cảnh mâu thuẫn với nó.

## UI khi chờ

Director không stream nên user ngồi im 10 tới 30 giây trước chữ đầu tiên. Với model reasoning có
thể lâu hơn.

Trong phản hồi hiện **một dòng** kiểu "đang chỉ đạo". Dòng đó phải xoá khi Writer bắt đầu chảy chữ,
và **tuyệt đối không lưu vào nội dung tin nhắn** — không thì nó lọt vào history rồi lượt sau
Director đọc thấy.

Tới Writer thì stream reasoning bình thường như mọi khi.

## Token và chi phí

Bộ đếm token của history và context **không** tính packet và **không** tính call Director — hai
thứ đó không nằm trong RP thật. Còn tiền thật thì vẫn tính đủ.

Nói thẳng về chi phí: tính năng này **đắt hơn** dùng một model, không rẻ hơn. Director vẫn phải đọc
trọn context mỗi lượt nên input token không giảm chút nào, chỉ thêm một call nữa.

Số thật từ mấy bản đã có: extension Tracker chỉ đọc 5 tin gần nhất mà đã ~9k token mỗi lượt, tác
giả tính ~1 triệu token cho 100 tin nhắn (~0,3 USD trên DeepSeek). Recursion tự khai thêm 1 đến 1,5
cent mỗi lượt. Director đọc full context nên sẽ đắt hơn cả hai.

Chỗ tiết kiệm thật duy nhất là Writer chạy local (webllm, ooba, ollama).

## Debug log

Bật/tắt riêng, **mặc định tắt**.

Mỗi lượt một dòng JSONL, append. Nội dung mỗi dòng:

- Thời điểm, chat id, message id
- Đường nào chạy: mới / reroll-writer / continue
- Hash khớp hay không, và lý do gọi Director
- Baseline văn phong: previous-writer / greeting / none
- Director: preset, model, token vào ra, thời gian, **packet nguyên văn**
- Nếu Director fail hoặc phải retry: raw response, normalized packet, validation/error và thời gian
  của từng attempt, để không mất câu trả lời lỗi của model/provider
- Director: **chỉ hash và số token của prompt đầu vào**, không lưu nguyên văn
- Writer: preset, model, token, độ dài output
- Validate: pass/fail, thiếu header nào, retry mấy lần
- Hash prompt Director và hash schema lúc đó

Lý do không lưu nguyên văn prompt Director: đó là cả context 50–100k token, vài trăm KB mỗi lượt,
trăm lượt là mấy trăm MB. Muốn xem nguyên văn thì đã có `fetchLog`
(`src/ts/globalApi.svelte.ts:53`) và prompt info lo. Bỏ nó ra thì mỗi dòng chỉ vài KB, sống mãi
thoải mái.

Hash prompt Director và hash schema là thứ cho phép **cải thiện từ từ**: sửa prompt rồi chơi tiếp,
log tự chia được trước và sau khi sửa, so được là có tốt lên thật không. Không có hash đó thì log
trộn lẫn, xem cả ngàn dòng cũng không kết luận được gì.

Lưu trữ:

- Sống mãi, lưu qua `forageStorage` (`src/ts/globalApi.svelte.ts:49`)
- **Key riêng, không nhét vào `db`** — db đi theo file save và cloud sync, log nằm trong đó thì
  backup phồng lên và sync chậm dần
- Nút tải về dùng `downloadFile` (`src/ts/globalApi.svelte.ts:67`), chạy cả web, Tauri, mobile
- Hiện số lượt đang có và dung lượng đang chiếm, cạnh một nút xóa
- Nắp đếm theo số lượt, không theo MB

Cảnh báo phải ghi trong UI: log chứa nội dung chat ở dạng thô, **không mã hóa** như file save của
Risu. Đừng gửi nguyên file cho người khác khi nhờ xem lỗi.

## Hazard — tại sao không dùng `changeToPreset`

`changeToPreset` (`src/ts/storage/database.svelte.ts:2146`) không phải truyền tham số, nó làm ba việc:

1. `saveCurrentPreset()` — ghi giá trị db **hiện tại** đè lên `botPresets[botPresetsId]`
2. `db.botPresetsId = id`
3. `setPreset(db, newPres)` — gán **86 field** vào `DBState.db` (`:2157-2275`)

Và `sendChat` đọc config qua `DBState.db.*` ở **126 chỗ**, không chỗ nào qua `getDatabase()`.

Nếu đổi preset giữa lượt:

- **Preset user bị ghi đè âm thầm.** Chuỗi A→B lặp nhiều lượt sẽ dần bơm giá trị runtime vào slot
  preset. Bug làm hỏng dữ liệu user mà không ai phát hiện trong nhiều tuần.
- **Abort không restore.** User bấm stop giữa lượt thì db đứng ở preset B, đã persist. Mở settings
  thấy model lạ, không hiểu vì sao.
- **saveDb churn.** 86 field × 2 lần/lượt trên `DBState.db` (Svelte 5 `$state` proxy). Git log đã có
  **hai** lần revert cùng một PR về vùng này (`72ce7218`, `33b665d1`).
- **`botPresetsId` sai giữa lượt.** Preset dropdown, hotkey `Alt+1..9` (`src/ts/hotkey.ts:186-234`),
  `src/ts/loadout.ts:63` đều đọc nó.

`presetChain` hiện tại (`src/ts/process/index.svelte.ts:221`) **không** bị mấy lỗi này vì nó switch
một lần rồi ở đó luôn — switch là ý định cuối cùng. Pipeline thì switch là tạm thời và phải hoàn
nguyên. Khác bản chất, không copy được cách làm của nó.

### Làm thay bằng gì

Đọc field từ `botPresets[id]` rồi truyền vào `requestChatData`. Ba cái đầu đã là param sẵn có:

| Field preset | Param |
|---|---|
| `aiModel` | `arg.staticModel` (`request/request.ts:49`, `:440`) |
| `temperature` | `arg.temperature` |
| `maxResponse` | `arg.maxTokens` |
| `promptTemplate`, `jailbreak`, `promptSettings` | dùng để build `formated` |

Cách này khớp với extension Tracker-Enhanced bên SillyTavern — nó quảng cáo hẳn là "không bao giờ
đổi profile đang active giữa request", rồi chỉ copy temperature, top_p, top_k, penalty, stop string,
max token sang một request riêng.

## Điểm chèn trong code

Toàn bộ `sendChat()` (`src/ts/process/index.svelte.ts:99`) — khoảng 1400 dòng — chỉ để build biến
`formated: OpenAIChat[]`, rồi gọi **đúng một lần** ở `:1554`. Director chèn ngay trước dòng đó và
dùng luôn `formated` đã build. Không phải dựng lại ngữ cảnh.

Bên nào chạy full pipeline: **Director**. Nó là bên cần lorebook đã activate, HypaV3 memory, history
theo `formatingOrder`, regex/script đã apply. Writer chỉ cần ba message nên dựng tay.

## Rủi ro đã biết từ nghiên cứu

**Không ai làm "writer chỉ thấy packet".** narrative-director, sillytavern-tools và Recursion đều
nhét chỉ đạo vào **cạnh** full context. Recursion nói thẳng SillyTavern vẫn là thằng viết văn và
dùng nguyên preset với context của nó.

Bài *When Do Multi-Agent Systems Help? An Information Bottleneck Perspective*
(arXiv 2607.16133) đo đúng chuyện này:

- Chia việc có lợi hay không hoàn toàn là chuyện nén. Lợi khi cái bị bỏ phần lớn là rác, lỗ khi bỏ
  mất bằng chứng thằng sau cần.
- Biến thể "có plan nhưng vẫn chung context" cho kết quả **thấp hơn** một model chạy thẳng. Kết luận
  của họ: chính việc **cách ly context** mới sinh ra lợi ích, không phải việc chia việc.
  → Cách của mấy extension kia theo lý thuyết gần như không lợi. Thiết kế này có cơ sở hơn.
- **Cảnh báo 1:** nén giúp model yếu và **hại** model mạnh. Lợi ích teo dần khi Writer mạnh lên.
  Đổi Writer lên model mạnh hơn thì phải đo lại.
- **Cảnh báo 2:** failure mode nặng nhất là ràng buộc toàn cục rơi lúc chia việc. Ví dụ của họ: cái
  budget 1.400 USD không được ghi vào spec con nào nên hệ nhiều agent trả về lịch trình 1.599 USD,
  còn bản full-context thì không vượt. → Lý do bắt buộc giữ jailbreak và luật POV ở tầng Writer.
- Thứ hay vỡ khi nén: định danh chính xác, trạng thái, con số. → Tên riêng, câu trích, vị trí,
  ai biết gì.

Mặt coherence thì hướng này có bằng chứng tốt: DOC hơn Re3 22,5% về plot coherence, Re3 hơn sinh
trực tiếp 14% về plot mạch lạc và 20% về đúng premise.

Cái duy nhất narrative-director ghi là hạn chế: chất lượng phân tích phụ thuộc khả năng
structured-output của model — đúng lý do chọn text thay vì JSON.

Recursion cũng cần model structured-reasoning mạnh cho mode gộp (họ nêu tên DeepSeek, Qwen,
Nemotron), model nhỏ thì bị đẩy sang mode chia nhỏ.

## Chưa quyết, để sau

- Bước kiểm continuity riêng sau khi Writer viết. Mấy bản khác đều có (Judge, review pass,
  post-process deck) nhưng tốn thêm 1–2 call mỗi lượt. `[LAST TURN NOTES]` đã lo phần lớn việc này
  với giá 0 đồng nên chưa cần.
- Ca tick cả Director lẫn Writer lên cùng một preset — đã chặn ở UI nên không phải xử.
- Impersonate và auto-suggest: dùng đường cũ, không qua Director.

## Danh sách test

- Tắt tính năng, chơi vài lượt, bật lại
- Reroll tin sinh ra lúc tính năng tắt
- Xóa tin mới rồi reroll tin cũ
- Swipe tin ở giữa, xóa tin user, tắt tin nhắn, đổi greeting
- Tạo nhánh chat mới
- Đổi preset Director/Writer giữa chat
- Continue tay và auto-continue khi câu bị cắt
- Bấm stop lúc Director đang chạy
- Group chat 3+ nhân vật
- Chat mới hoàn toàn, và chat mới có greeting
- Bấm preview prompt trong DevTool — Director không được chạy
- Mở lại chat cũ — Director không được chạy
- Director trả về prose thay vì packet — phải fail và retry
- Writer trả lời sai ngôn ngữ
