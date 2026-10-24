import type { ShowsData } from './types'

/**
 * Демо-набор до подключения CMS (T-021). Источник — публичный сайт театра teatrturdus.ru
 * по состоянию на 14.10.2026: названия, даты, площадки, возраст, длительность, тексты и
 * составы перенесены дословно; обложки (posterUrl) — превью карточек с главной сайта на 16.10.2026. Цена известна только для «Трёх поэтов» (1000 ₽, 20 зрителей);
 * у остальных показов продажи на сайте не открыты, пока театр не передаст цены и квоты.
 * Изображения — с CDN текущего сайта театра; в production медиа загружаются в CMS.
 */

const tz = '+05:00'

/**
 * Файл из `public/` (афиши, переданные театром). next/image сам не добавляет basePath к
 * локальному адресу — на GitHub Pages (/trds) префикс нужен вручную (документация basePath).
 */
export const publicAsset = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}${path}`
const at = (date: string, time: string) => `${date}T${time}:00${tz}`

// ЗАГЛУШКА по просьбе заказчика (15.10.2026): цены категорий не утверждены театром.
// Заменить на утверждённые до запуска продаж (memory.md).
const vertinskyNovemberSeating = {
  planId: 'dom-kultury',
  pricesKopecks: {
    'cat-1': 300_000,
    'cat-2': 280_000,
    'cat-3': 260_000,
    'cat-4': 240_000,
    'cat-5': 220_000,
    'cat-6': 200_000,
    'cat-7': 180_000,
  },
  pricesPlaceholder: true,
  unavailableSeatIds: [],
}

// Схема зала есть, цены театр не передал — места видны, продажа закрыта.
const dkSeatingClosed = { planId: 'dom-kultury', pricesKopecks: {}, unavailableSeatIds: [] }

// ДЕМО-продажи до учёта мест (T-042): показывают все состояния индикатора остатка.
const threePoetsTickets = (sold: number) => [
  { id: 'standard', title: 'Входной билет', priceKopecks: 100_000, capacity: 20, sold },
]

export const demoShowsData: ShowsData = {
  venues: [
    { id: 'dk', title: 'Бар «Дом Культуры»', address: 'ул. Бажова, 193', kind: 'bar' },
    {
      id: 'vysota',
      title: 'Ресторан «Высота 5642»',
      address: 'ул. Воеводина, 8, 9 этаж, ТЦ Limerance Fashion Center',
      kind: 'restaurant',
    },
    {
      id: 'leburg',
      title: 'Ресторан «Ле Бург»',
      address: 'ул. Вайнера, 9, 4 этаж, ТЦ «Пассаж»',
      kind: 'restaurant',
    },
    {
      id: 'baton',
      title: 'Лофт «Батон», Хлебозавод №6',
      address: 'ул. 8 Марта, 203',
      kind: 'loft',
    },
    {
      id: 'flat',
      title: 'Квартира',
      address: 'ул. Юмашева, 10, кв. 149 (3 подъезд, 6 этаж)',
      kind: 'apartment',
    },
    { id: 'dom-aktera', title: 'Дом актёра', address: 'ул. 8 Марта, 8', kind: 'stage' },
    {
      id: 'central-hotel',
      title: 'Отель «Центральный» — старт прогулки',
      address: 'ул. Малышева, 74, ресепшен',
      kind: 'city',
    },
  ],

  shows: [
    {
      slug: 'three-poets',
      eventType: 'promenade',
      title: 'Три поэта',
      genre: 'Аудиоспектакль-променад',
      ageLimit: 16,
      durationMinutes: 60,
      lead: 'Иммерсивный аудиоспектакль-променад по Екатеринбургу: спектакль в наушниках, 20 зрителей.',
      description: [
        '«Три поэта» — это возможность увидеть Екатеринбург глазами трех великих авторов: Владимира Маяковского, Иосифа Бродского и Бориса Рыжего. Надев наушники, зрители отправляются в неспешную прогулку по центру города, где привычные улицы становятся декорациями, а голоса поэтов переплетаются с реальностью, открывая новые смыслы знакомых мест.',
        'Маршрут проходит от Центральной Гостиницы по улице Малышева, через набережную и мост, сопровождаемый интерактивными сценами и небольшими уличными перформансами. Каждый становится не просто зрителем, а частью спектакля, проживая эту историю в собственном ритме.',
        'Всё действие сопровождается модератором, который мягко ведёт группу по маршруту, помогает с техникой и обеспечивает комфортное восприятие на протяжении всего спектакля.',
      ],
      credits: [],
      gallery: [],
      posterUrl: 'https://static.tildacdn.com/tild3138-3832-4733-b836-653066323964/19201080.jpg',
      status: 'published',
    },
    {
      slug: 'vbare2',
      eventType: 'immersive',
      title: 'Секс в большом баре 2.0',
      genre: 'Иммерсивная стендап-комедия',
      ageLimit: 18,
      durationMinutes: null,
      lead: 'Бар «Дом Культуры» и модный театр TURDUS представят жителям Екатеринбурга иммерсивный спектакль в стиле стендап!',
      description: [
        'Вечер пройдет в формате стендап от четырех обворожительных девушек. Уникальность проекта в полном погружении зрителей в действие: сцена – везде, актеры свободно перемещаются от барной стойки к танцполу, общаются как с персоналом, так и с гостями, показывая моменты из жизни заведения.',
        'Пять подруг (среди которых психолог/сексолог) – собирательные образы очаровательных женщин, которые за барной стойкой делятся со зрителями своими курьезными барными историями, яркими желаниями, легкими мечтами и отвечают на актуальные вопросы завсегдатаев ночной жизни.',
      ],
      credits: [
        {
          role: 'Режиссер',
          entries: [{ people: ['Артём Аксёнов'] }],
        },
        {
          role: 'Автор',
          entries: [{ people: ['Татьяна Усова'] }],
        },
        {
          role: 'В ролях',
          entries: [
            { people: ['Татьяна Пискун', 'Екатерина Никольская'] },
            { people: ['Яна Шайдетская', 'Елена Руссу'] },
            { people: ['Александра Рейн', 'Валерия Розенблит'] },
            { people: ['Татьяна Усова'] },
            { character: 'Психолог/сексолог', people: ['Елена Чупахина'] },
          ],
        },
        {
          role: 'Хореограф',
          entries: [{ people: ['Владислав Каримов'] }],
        },
      ],
      gallery: [
        'https://static.tildacdn.com/tild3331-6665-4238-b238-323232326463/DSCF0142_1.jpg',
        'https://static.tildacdn.com/tild3631-6463-4262-b231-373339343131/DSCF0140.jpg',
        'https://static.tildacdn.com/tild3837-6535-4736-b764-316361636264/DSCF0363.jpg',
        'https://static.tildacdn.com/tild3334-3033-4665-b463-623932663166/DSCF0375.jpg',
        'https://static.tildacdn.com/tild6362-6234-4035-b334-373565663665/DSCF0343.jpg',
        'https://static.tildacdn.com/tild3934-3466-4561-b232-396539386137/DSCF0448.jpg',
        'https://static.tildacdn.com/tild3739-3863-4334-b737-613030366561/DSCF0382.jpg',
        'https://static.tildacdn.com/tild3566-3064-4539-b232-306466616432/DSCF0331.jpg',
      ],
      posterUrl:
        'https://static.tildacdn.com/tild6364-6263-4232-b337-363031623136/_2026-05-22_21564295.png',
      status: 'published',
    },
    {
      slug: 'guests',
      eventType: 'performance',
      title: 'Гости',
      genre: 'Перформанс-беседа',
      ageLimit: 18,
      durationMinutes: 150,
      lead: 'Театральный перформанс в жанре беседы за столом, в котором главные герои — гости.',
      description: [
        'Добрая традиция ходить друг к другу в гости. Застольные беседы отличаются искренностью и душевностью, хозяйка дома проявляет свое радушие и обязательно угостит своим фирменным блюдом, а хозяин задает тон вечера и создает атмосферу гостеприимства. Предлагаем укреплять эту традицию и встретиться!',
        'Хозяин вечера – руководитель модного театра «TURDUS», актер и режиссер Артем Аксенов. Все зрители – приглашенные гости, которые могут быть активными участниками беседы или просто наблюдателями.',
        'Перформанс обладает терапевтическим действием, предлагает погрузиться в себя, задаться, возможно, неудобными вопросами и найти свои собственные ответы на них. Повод встретиться и насладиться глубоким общением. Приходите в гости!',
      ],
      credits: [
        {
          role: 'Хозяин вечера',
          entries: [{ people: ['Артём Аксёнов'] }],
        },
      ],
      gallery: [
        'https://static.tildacdn.com/tild6231-6239-4632-a265-373364393765/2023_0205-1.jpg',
        'https://static.tildacdn.com/tild3931-3564-4261-b734-633965326561/2023_0205-2.jpg',
        'https://static.tildacdn.com/tild6134-6230-4463-a361-336632643335/2023_0205-3.jpg',
        'https://static.tildacdn.com/tild6334-6666-4238-b964-326630333132/2023_0205-4.jpg',
        'https://static.tildacdn.com/tild6136-3862-4361-b164-336633333633/2023_0205-6.jpg',
        'https://static.tildacdn.com/tild6637-6630-4737-b736-626438336538/2023_0205-7.jpg',
        'https://static.tildacdn.com/tild3965-6632-4361-b739-613238353430/2023_0205-8.jpg',
        'https://static.tildacdn.com/tild6331-3239-4338-b834-316265623664/2023_0205-11.jpg',
        'https://static.tildacdn.com/tild3861-3137-4632-b832-396239653766/2023_0205-16.jpg',
        'https://static.tildacdn.com/tild3133-3134-4430-a434-363732393435/2023_0205-17.jpg',
        'https://static.tildacdn.com/tild6662-6535-4332-b035-326265643831/2023_0205-19.jpg',
        'https://static.tildacdn.com/tild3262-6361-4531-a434-636463306363/2023_0205-20.jpg',
        'https://static.tildacdn.com/tild3435-6663-4738-a138-393437343863/2023_0205-22.jpg',
        'https://static.tildacdn.com/tild6631-3462-4135-b335-383736346365/2023_0205-24.jpg',
        'https://static.tildacdn.com/tild3965-3465-4362-a366-313833396530/2023_0205-27.jpg',
        'https://static.tildacdn.com/tild3830-6538-4837-a162-303763363732/2023_0205-31.jpg',
        'https://static.tildacdn.com/tild6165-6136-4266-a662-376161343966/2023_0205-33.jpg',
        'https://static.tildacdn.com/tild3239-6236-4632-a334-613864303334/2023_0205-34.jpg',
        'https://static.tildacdn.com/tild6333-6633-4535-b737-313432353665/2023_0205-36.jpg',
        'https://static.tildacdn.com/tild6563-3330-4734-b261-353466646130/2023_0205-41.jpg',
      ],
      posterUrl:
        'https://static.tildacdn.com/tild6166-3339-4664-a161-383233653663/_2026-06-16_15025051.png',
      status: 'published',
    },
    {
      slug: '8women',
      eventType: 'spectacle',
      title: '8 любящих женщин',
      genre: 'Комедийный детектив',
      ageLimit: 16,
      durationMinutes: 140,
      lead: 'Комедийный детектив по пьесе Робера Тома в новом прочтении режиссера Ирины Павловой.',
      description: [
        'Как всякий хороший детектив спектакль начинается с обнаружения трупа. Глава семейства убит в собственном доме! Конечно, кроме восьми самых близких ему женщин, сделать этого никто не мог. Непогода отрезает героинь от внешнего мира и изолирует в шикарном семейном особняке во французской глубинке выяснять кто из них совершил преступление.',
        'Спектакль отличается тонким юмором и стильной подачей. Высокую оценку получила работа художника по костюмам Анны Слепых за детальную проработку образов и точную передачу творческого замысла режиссера.',
        'Спектакль может сопровождаться тифлокомментированием при заявке от 10 человек.',
      ],
      credits: [
        {
          role: 'Режиссер',
          entries: [{ people: ['Ирина Павлова'] }],
        },
        {
          role: 'Художник',
          entries: [{ people: ['Анна Слепых'] }],
        },
        {
          role: 'В ролях',
          entries: [
            { character: 'Габи', people: ['Надежда Ускова'] },
            { character: 'Бабушка', people: ['Марина Шуранова'] },
            { character: 'Огюстина', people: ['Елена Руссу'] },
            { character: 'Сюзон', people: ['Кристина Русанова', 'Юлия Штенцель'] },
            { character: 'Катрин', people: ['Ольга Тренбач'] },
            { character: 'Пьеретта', people: ['Валерия Розенблит', 'Татьяна Усова'] },
            { character: 'Шанель', people: ['Яна Шайдетская'] },
            { character: 'Луиза', people: ['Анастасия Нохова', 'Татьяна Усова'] },
          ],
        },
      ],
      gallery: [
        'https://static.tildacdn.com/tild3735-3062-4464-b334-653263313861/DSCF0508_1.jpg',
        'https://static.tildacdn.com/tild3965-6335-4265-b963-373531666633/DSCF0405_1.jpg',
        'https://static.tildacdn.com/tild3034-3930-4531-a232-323436343738/DSCF0438_1.jpg',
        'https://static.tildacdn.com/tild3665-3938-4630-b761-666231643936/DSCF0452_1.jpg',
        'https://static.tildacdn.com/tild6630-6537-4339-a262-613737386562/DSCF0458_1.jpg',
        'https://static.tildacdn.com/tild3931-6438-4637-b637-383835396664/DSCF0498_1.jpg',
      ],
      posterUrl: 'https://static.tildacdn.com/tild3665-3932-4631-b034-383534633434/-_____3.JPG',
      status: 'published',
    },
    {
      slug: 'normalflight',
      eventType: 'immersive',
      title: 'Полёт нормальный: история одной любви',
      genre: 'Иммерсивный музыкальный спектакль',
      ageLimit: null,
      durationMinutes: null,
      lead: 'Пространство бара «Дом Культуры» превращается в салон самолёта: на борту — три стюардессы, капитан и одна история любви.',
      description: [
        'Действие начинается с найденной записки с признанием — и каждая из героинь решает, что она адресована именно ей. Пока за иллюминатором непогода, на борту продолжается жизнь: музыка, живое общение, внимание к каждому гостю и неожиданные повороты сюжета, в которых проявляются характер и чувства героев. Но финал расставит всё по своим местам.',
        'Сюжет спектакля построен на реальных историях стюардесс которые происходили с ними и пассажирами в полете. Гастрономическая часть вечера - все как на борту - напитки (вода, чай, сок) на выбор, причем в таких же стаканчиках.',
      ],
      credits: [
        {
          role: 'Режиссер и продюсер',
          entries: [{ people: ['Артём Аксёнов'] }],
        },
        {
          role: 'Хореограф',
          entries: [{ people: ['Владислав Каримов'] }],
        },
        {
          role: 'Действующие лица',
          entries: [
            { character: 'Венера', people: ['Татьяна Пискун', 'Мария Хвастова'] },
            { character: 'Анфиса', people: ['Елена Руссу', 'Валерия Розенблит'] },
            { character: 'Гера, старшая стюардесса', people: ['Яна Шайдетская'] },
            {
              character: 'Александр Парисов, командир корабля',
              people: ['Максим Тихонов', 'Денис Денисов'],
            },
          ],
        },
      ],
      gallery: [
        'https://static.tildacdn.com/tild6666-3562-4563-b466-613939313134/200523_turdus-8722.jpg',
        'https://static.tildacdn.com/tild3339-3837-4466-b663-366336363831/200523_turdus-8646.jpg',
        'https://static.tildacdn.com/tild6237-3332-4461-b366-656531336439/200523_turdus-8689.jpg',
        'https://static.tildacdn.com/tild3765-3130-4839-a337-383365396666/200523_turdus-8738.jpg',
        'https://static.tildacdn.com/tild6133-6438-4533-b065-626564303132/200523_turdus-8755.jpg',
        'https://static.tildacdn.com/tild3633-6131-4339-b366-643036373737/200523_turdus-9032.jpg',
        'https://static.tildacdn.com/tild3764-3564-4631-a638-376231633236/200523_turdus-8725.jpg',
        'https://static.tildacdn.com/tild6130-6135-4365-b134-646331346464/200523_turdus-9041.jpg',
      ],
      posterUrl:
        'https://static.tildacdn.com/tild3662-6436-4165-b266-313365366535/_2026-04-28_20333470.png',
      status: 'published',
    },
    {
      slug: 'playapt',
      eventType: 'spectacle',
      // Пометка «Премьера» на сайте театра (14.10.2026).
      premiere: true,
      title: 'История одной девочки',
      genre: 'Спектакль в квартире',
      ageLimit: null,
      durationMinutes: null,
      lead: 'Впервые в Екатеринбурге спектакль пройдет не в театральном зале, а в реальной квартире.',
      description: [
        '«История одной девочки» — это камерный моноспектакль о детстве, которое пришлось на совсем не детское время. Это не рассказ о 90-х как об эпохе. Это история ребенка, который каждый день открывает для себя мир — со страхами и радостями, первыми разочарованиями, мечтами и вопросами, на которые взрослые не всегда находят ответы.',
        'Зрители окажутся не просто рядом с героиней, а внутри этой истории. Настоящая квартира станет пространством воспоминаний, где можно будет вновь почувствовать то самое ощущение из детства — когда мир был огромным, неизведанным и полным тайн.',
        'Спектакль основан на пьесе Елены Руссу и рассказывает личную историю взросления — честную, трогательную и очень узнаваемую.',
      ],
      credits: [
        {
          role: 'Автор пьесы',
          entries: [{ people: ['Елена Руссу'] }],
        },
      ],
      gallery: [],
      posterUrl: 'https://static.tildacdn.com/tild3434-3333-4438-b632-613965356662/noroot.png',
      status: 'published',
    },
    {
      slug: 'shakespeare',
      eventType: 'spectacle',
      // Пометка «Премьера» на сайте театра (14.10.2026).
      premiere: true,
      title: 'Весь Шекспир за 1,5 часа',
      genre: 'Спектакль',
      ageLimit: null,
      durationMinutes: 90,
      lead: 'Мы запускаем столкновение великих пьес Уильяма Шекспира с сегодняшним днем на скорости, от которой захватывает дух.',
      description: [
        'Это не просто спектакль. Это карнавал, площадной буфф и бешеная энергия. За непочтительной, дерзкой формой скрывается превосходное знание материала и не показная, а очень личная любовь к Великому драматургу!',
        'Вы увидите «ускоренного Гамлета», танцующего заколотого Тибальта и Джульетту, которую играет... мужчина. Всё по канонам театра слуг лорда-камергера, но с драйвом XXI века.',
        'Это интерактив! Здесь нет четвертой стены - есть общее дыхание площадного театра. Вы не просто смотрите - вы становитесь частью толпы зевак в самом лучшем смысле этого слова.',
      ],
      credits: [
        {
          role: 'Режиссер',
          entries: [{ people: ['Ирина Павлова'] }],
        },
        {
          role: 'В ролях',
          entries: [
            { people: ['Виталий Корбесашвили'] },
            { people: ['Борис Зырянов'] },
            { people: ['Сергей Молочков'] },
          ],
        },
        {
          role: 'Звук, свет',
          entries: [{ people: ['Елизавета Чичиланова'] }],
        },
      ],
      gallery: [],
      posterUrl: 'https://static.tildacdn.com/tild3739-3262-4635-b966-376466623765/__686686.jpg',
      status: 'published',
    },
    {
      slug: 'facetoface',
      eventType: 'performance',
      // Пометка «Премьера» на сайте театра (14.10.2026).
      premiere: true,
      title: 'Лицом к лицу',
      genre: 'Перформанс-эксперимент',
      ageLimit: 16,
      durationMinutes: 90,
      lead: 'Пара конвертов, несколько вопросов и немного смелости — всё, что нужно, чтобы увидеть человека по-настоящему.',
      description: [
        'Можно ли за один вечер почувствовать, что рядом — «свой» человек? «Лицом к Лицу» — это не игра и не свидание, а возможность заглянуть в мысли другого через письменно оформленные ответы.',
        'Пары формируются из людей, которые не знают друг друга. Даже если гости приходят вместе, участвовать они будут раздельно — в разных парах.',
        'Каждому участнику выдаётся конверт с вопросами — не о повседневном, а о том, что заставляет задуматься и вспомнить важное. Финальный момент — обмен записями и впечатлениями, когда слова становятся тише, а впечатления — ярче.',
      ],
      credits: [
        {
          role: 'Режиссер, продюсер',
          entries: [{ people: ['Артём Аксёнов'] }],
        },
      ],
      gallery: [
        'https://static.tildacdn.com/tild6661-3666-4363-a138-306139333566/DSCF2054.jpg',
        'https://static.tildacdn.com/tild6339-3136-4533-b163-316137626662/DSCF1948.jpg',
        'https://static.tildacdn.com/tild3762-3434-4632-a339-356166366266/DSCF1869.jpg',
        'https://static.tildacdn.com/tild3237-6230-4031-a361-333132346235/DSCF1804.jpg',
        'https://static.tildacdn.com/tild3461-3633-4466-b432-623539613331/DSCF1976.jpg',
        'https://static.tildacdn.com/tild6236-3866-4237-b937-333764626430/DSCF2019.jpg',
        'https://static.tildacdn.com/tild3936-3161-4630-a338-373938306533/DSCF1957.jpg',
      ],
      posterUrl:
        'https://static.tildacdn.com/tild6136-3735-4535-a166-306462633161/_2026-06-29_20035340.png',
      status: 'published',
    },
    {
      slug: 'crime-punishment',
      eventType: 'spectacle',
      // Пометка «Премьера», дата 23.11 19:00 — с афиши театра (24.10.2026); жанр, тексты,
      // длительность, состав и фото — дословно с teatrturdus.ru/crimeandpunishment (24.10.2026).
      // Билеты на старом сайте — виджет Ticketscloud; цен у нас нет — продажа на сайте закрыта.
      premiere: true,
      announcedAt: '2026-10-24',
      title: 'Преступление? Наказание?',
      genre: 'Оживающий графический роман',
      ageLimit: 12,
      durationMinutes: 90,
      lead: 'Это не инсценировка. Это попытка заглянуть в черновики вселенной Достоевского.',
      description: [
        'Представьте сцену как чистый лист. По горизонтали его пересекает бесконечный стол — символ земной жизни, Вечери, за которой собрались герои. По вертикали — белое полотно Книги, пространство вечных образов и метафор. В точке их пересечения — Крест. Здесь сталкиваются реальность и мир идей.',
        'Мы сохранили главное: моменты, когда герои обращаются к «народу». В сценах покаяния, бунта или поиска сочувствия свет из пространства сцены направится в зал. Вы станете не просто наблюдателями, а свидетелями. Ваша рефлексия — часть спектакля.',
        '«Преступление? Наказание?» — это театр, который задает вопросы, а не дает ответы. Присоединяйтесь к поиску истины.',
        'Спектакль проходит в креативном кластере ХлебЗавод №6, ул. 8 Марта, 203, лофт «Батон». При заказе такси указывайте точку — лофт «Батон».',
      ],
      credits: [
        { role: 'Режиссер', entries: [{ people: ['Ирина Павлова'] }] },
        { role: 'Продюсер', entries: [{ people: ['Артём Аксёнов'] }] },
        { role: 'Художник по костюмам', entries: [{ people: ['Анна Слепых'] }] },
        { role: 'Медиахудожник', entries: [{ people: ['Иван Ханжин'] }] },
        {
          role: 'В ролях',
          entries: [
            { people: ['Александр Борисов'] },
            { people: ['Мария Викулина'] },
            { people: ['Александра Протасова'] },
            { people: ['Алексей Пинигин'] },
            { people: ['Наталия Кузнецова'] },
            { people: ['Максим Удинцев'] },
            { people: ['Никита Дидковский'] },
          ],
        },
      ],
      gallery: [
        'https://static.tildacdn.com/tild3162-3233-4139-b937-396333633832/IMG_8284.jpg',
        'https://static.tildacdn.com/tild3863-6132-4135-b363-633939663461/_2026-10-15_09404990.png',
        'https://static.tildacdn.com/tild6530-3465-4430-a235-663865346665/_2026-10-15_09411937.png',
        'https://static.tildacdn.com/tild6663-6334-4430-a630-396431303731/_2026-10-15_09420491.png',
        'https://static.tildacdn.com/tild3637-6138-4765-a639-663637333365/_2026-10-15_09422511.png',
        'https://static.tildacdn.com/tild3936-3962-4461-a135-616461316432/_2026-10-15_09423123.png',
        'https://static.tildacdn.com/tild3333-3233-4863-b661-356438626236/_2026-10-15_09425592.png',
      ],
      posterUrl: publicAsset('/posters/crime-punishment.webp'),
      previewUrl: publicAsset('/posters/crime-punishment-card.webp'),
      coverUrl: publicAsset('/posters/crime-punishment-cover.webp'),
      // Фигура внизу кадра — в широкой полосе обложки держим её в поле зрения.
      coverFocus: '50% 85%',
      status: 'published',
    },
    {
      slug: 'concertsp',
      eventType: 'concert',
      title: 'В бананово-лимонном Сингапуре',
      genre: 'Иммерсивное кабаре',
      ageLimit: 18,
      durationMinutes: 100,
      lead: 'Иммерсивный концерт-спектакль, посвящённый творчеству Александра Вертинского.',
      description: [
        'Ностальгия по двадцатому веку, желание погрузиться в глубину мыслей и чувств талантливого артиста, возродить традицию светских вечеров – лейтмотив создания серии иммерсивных концертов. Зритель - участник события, где нет четкого разграничения между сценой и залом.',
        'В программе вечера: песни и стихи Вертинского в исполнении артистов театра «TURDUS», отрывки из спектакля «В бананово-лимонном Сингапуре», факты из жизни и творчества кумира российской эстрады первой половины XX века. Все это под аккомпанемент живой музыки в атмосфере светского салона с напитками и приятным общением.',
        'Спектакль адаптирован для незрячих и слабовидящих зрителей, благодаря грантовой поддержке программы «Особый взгляд» благотворительного фонда «Искусство, наука и спорт» и при организационной поддержке АНО «Ген Гуманизма».',
      ],
      credits: [
        {
          role: 'Режиссер',
          entries: [{ people: ['Артём Аксёнов'] }],
        },
      ],
      gallery: [
        'https://static.tildacdn.com/tild6535-3734-4035-b437-626537323832/_2025-12-07_14075159.png',
        'https://static.tildacdn.com/tild3463-3438-4630-b033-643238373162/_2025-12-07_14080024.png',
        'https://static.tildacdn.com/tild3064-3534-4739-b662-643339363539/_2025-12-07_14083392.png',
        'https://static.tildacdn.com/tild3062-3563-4031-a165-313038343939/_2025-12-07_14072830.png',
        'https://static.tildacdn.com/tild3433-6563-4839-a339-643164323336/_2025-12-07_14073738.png',
        'https://static.tildacdn.com/tild6365-3331-4836-b965-323934343032/_2025-12-07_14074299.png',
        'https://static.tildacdn.com/tild6361-3530-4730-a234-326430393937/_2025-12-07_14072078.png',
      ],
      posterUrl:
        'https://static.tildacdn.com/tild3637-6664-4735-b931-653665393233/_2026-10-14_05075963.png',
      status: 'published',
    },
    {
      slug: 'taro',
      eventType: 'immersive',
      title: 'Таро',
      genre: 'Музыкальная мистерия',
      ageLimit: 16,
      durationMinutes: null,
      lead: 'Воссоздаем атмосферу мистического салона. Рассадка гостей за столиками, обслуживание через официантов.',
      description: [
        'В новой постановке модного театра «TURDUS» порассуждают персонажи Старших арканов Таро. Шут, Звезда, Луна и даже Смерть не просто «оживут» перед зрителями, но и поведают о загадочных событиях из жизни реальных исторических личностей.',
        'Дресс-код – наряды, вдохновленные эстетикой карт Таро. Модный театр «TURDUS» - повод выйти в свет!',
      ],
      credits: [
        {
          role: 'Режиссер',
          entries: [{ people: ['Анастасия Нохова'] }],
        },
        {
          role: 'Сценарист',
          entries: [{ people: ['Татьяна Усова'] }],
        },
        {
          role: 'В ролях',
          entries: [
            { character: 'Шут', people: ['Максим Тихонов'] },
            { character: 'Луна', people: ['Валерия Розенблит'] },
            { character: 'Звезда', people: ['Татьяна Пискун', 'Татьяна Усова'] },
            { character: 'Справедливость', people: ['Елена Руссу'] },
            { character: 'Смерть', people: ['Яна Шайдетская'] },
          ],
        },
      ],
      gallery: [
        'https://static.tildacdn.com/tild3533-6132-4638-a564-323037613063/DSCF0068_1.jpg',
        'https://static.tildacdn.com/tild3637-6436-4233-a638-353837383136/DSCF0212.jpg',
        'https://static.tildacdn.com/tild3732-3661-4862-b538-656163313064/DSCF0234.jpg',
        'https://static.tildacdn.com/tild3061-3663-4266-b861-636437396436/DSCF0264_1.jpg',
        'https://static.tildacdn.com/tild3931-3030-4834-b631-323939396335/DSCF0268_2.jpg',
        'https://static.tildacdn.com/tild3332-3363-4838-a132-326232626332/DSCF0301.jpg',
        'https://static.tildacdn.com/tild3430-3532-4237-a430-303661383064/DSCF0305_1.jpg',
        'https://static.tildacdn.com/tild3938-6532-4166-b232-393062323538/DSCF0396.jpg',
        'https://static.tildacdn.com/tild3463-3437-4631-b838-366630363631/DSCF0433.jpg',
      ],
      posterUrl:
        'https://static.tildacdn.com/tild3561-3331-4431-b434-643434636565/_2025-12-25_20372842.png',
      status: 'published',
    },
    {
      slug: 'tasteofsuccess',
      eventType: 'immersive',
      title: 'Вкус успеха',
      genre: 'Иммерсивный спектакль',
      ageLimit: null,
      durationMinutes: 90,
      lead: 'Великие женщины XX века — Маргарет Тэтчер, Мария Каллас, Мэрилин Монро и Майя Плисецкая — рассказывают свою Историю Успеха.',
      description: [
        'Зрителей ждут не только драматические откровения: Мария Каллас оживёт в вокале, а Майя Плисецкая — в танце с фрагментом легендарной «Кармен». Между сценами гости станут участниками гастрономического перформанса: каждому образу будет соответствовать авторский коктейль.',
        'На протяжении спектакля гости создадут собственную картину: портрет одной из героинь или авторскую интерпретацию темы успеха.',
      ],
      credits: [],
      gallery: [],
      posterUrl: 'https://static.tildacdn.com/tild6361-6161-4661-a338-313465323136/noroot.png',
      status: 'published',
    },
  ],

  /**
   * Архив — прошедшие постановки со страницы teatrturdus.ru/past (16.10.2026). Составы —
   * дословно со страниц постановок; где имён на сайте нет — состав пустой (только название и афиша).
   * Соавторы — отдельными записями; несколько имён в одной записи — состав в очередь.
   */
  archive: [
    {
      slug: 'onegin',
      title: 'Другой Онегин',
      genre: 'Иммерсивный спектакль',
      posterUrl: 'https://static.tildacdn.com/tild6539-6562-4066-a533-666233623161/photo.png',
      credits: [
        {
          role: 'Режиссёры',
          entries: [{ people: ['Артём Аксёнов'] }, { people: ['Анастасия Нохова'] }],
        },
        { role: 'Драматург', entries: [{ people: ['Татьяна Усова'] }] },
        {
          role: 'В ролях',
          entries: [
            { character: 'Пушкин', people: ['Никита Бондаренко'] },
            { character: 'Онегин', people: ['Денис Денисов'] },
            { character: 'Татьяна', people: ['Татьяна Усова'] },
            { character: 'Мамушка', people: ['Марина Шуранова'] },
            { character: 'Крепостная крестьянка', people: ['Ольга Калашникова'] },
          ],
        },
      ],
    },
    {
      slug: 'dogville',
      title: 'Догвилль',
      genre: 'Кино-спектакль',
      posterUrl: 'https://static.tildacdn.com/tild3764-6230-4866-b461-643330303361/1200800__.jpg',
      credits: [
        { role: 'Режиссер', entries: [{ people: ['Александр Вахов'] }] },
        { role: 'В ролях', entries: [{ character: 'Главная роль', people: ['Анастасия Нохова'] }] },
      ],
    },
    {
      slug: 'historyhome',
      title: 'История одного дома',
      genre: null,
      posterUrl: 'https://static.tildacdn.com/tild6233-3434-4239-b665-633064333030/19201080_5.jpg',
      credits: [
        { role: 'Режиссер', entries: [{ people: ['Артём Аксёнов'] }] },
        { role: 'В ролях', entries: [{ people: ['Ксения Сосновских'] }] },
        {
          role: 'Сценаристы',
          entries: [{ people: ['Вера Плехова'] }, { people: ['Олег Таратухин'] }],
        },
      ],
    },
    {
      slug: 'onehistory',
      title: 'История одного рассказа',
      genre: 'Иммерсивный спектакль',
      posterUrl:
        'https://static.tildacdn.com/tild3531-6266-4762-b836-666435346133/History_1_rasskaz.jpg',
      credits: [{ role: 'Режиссер', entries: [{ people: ['Артём Аксёнов'] }] }],
    },
    {
      slug: 'guestssochi',
      title: 'Гости (Сочи)',
      genre: 'Спектакль-перформанс',
      posterUrl: 'https://static.tildacdn.com/tild6266-3031-4461-a262-386632346563/IMG_9326.JPG',
      credits: [{ role: 'Хозяин вечера', entries: [{ people: ['Артём Аксёнов'] }] }],
    },
    {
      slug: 'kkvartirnik',
      title: 'Театральный квартирник в караоке-баре',
      genre: 'Творческий вечер',
      posterUrl:
        'https://static.tildacdn.com/tild3264-6266-4537-b865-613434613530/19201080_01_8.jpg',
      credits: [{ role: 'Хозяин вечера', entries: [{ people: ['Артём Аксёнов'] }] }],
    },
    {
      slug: 'ogonek',
      title: 'Секс в большом баре',
      genre: null,
      posterUrl:
        'https://static.tildacdn.com/tild6465-3461-4939-a439-623130613939/19201080____1.jpg',
      credits: [
        {
          role: 'Авторы сценария',
          entries: [{ people: ['Татьяна Усова'] }, { people: ['Стефания-Марьяна'] }],
        },
      ],
    },
    {
      slug: 'letsswitch',
      title: 'Ирония судьбы, или Давайте поменяемся',
      genre: null,
      posterUrl:
        'https://static.tildacdn.com/tild3366-3331-4234-b165-626264373666/1920_1080_18_.JPG',
      credits: [{ role: 'Автор сценария', entries: [{ people: ['Саша Цариков'] }] }],
    },
    // Постановки из архива сайта без указанного состава: название, жанр и афиша.
    {
      slug: 'onroof',
      title: 'Театральный квартирник на крыше',
      genre: 'Творческий вечер',
      posterUrl:
        'https://static.tildacdn.com/tild6163-3732-4135-b566-303762336563/19201080_01_6.jpg',
      credits: [],
    },
    {
      slug: 'eatpray',
      title: 'Музыкальная терраса. Ешь. Пой. Люби.',
      genre: 'Творческий вечер',
      posterUrl: 'https://static.tildacdn.com/tild3330-3234-4537-b066-623161346339/eat.jpg',
      credits: [],
    },
    {
      slug: 'singapore',
      title: 'Рейс до Сингапура',
      genre: 'Иммерсивный ужин-спектакль',
      posterUrl: 'https://static.tildacdn.com/tild3562-3836-4437-b561-623530663836/1920x1080.jpg',
      credits: [],
    },
    {
      slug: 'mandrink',
      title: 'О чём пьют мужчины',
      genre: 'Иммерсивный спектакль',
      posterUrl: 'https://static.tildacdn.com/tild3237-3665-4730-b663-396265636534/19201080_8.jpg',
      credits: [],
    },
    {
      slug: 'mandrink2',
      title: 'О чём пьют мужчины 2',
      genre: 'Иммерсивный спектакль',
      posterUrl: 'https://static.tildacdn.com/tild3035-3263-4037-b133-383365626162/19201080_11.jpg',
      credits: [],
    },
    {
      slug: 'ozhogin',
      title: 'Иван Ожогин. В ожидании Рождества',
      genre: 'Концерт',
      posterUrl:
        'https://static.tildacdn.com/tild6465-3130-4639-b566-633265636563/2022-11-22_16-21-33.png',
      credits: [],
    },
  ],

  performances: [
    {
      id: 'taro-1008',
      showSlug: 'taro',
      venueId: 'dk',
      startsAt: at('2026-10-08', '19:00'),
      ticketTypes: [],
      seating: dkSeatingClosed,
    },
    {
      id: 'guests-1004',
      showSlug: 'guests',
      venueId: 'vysota',
      startsAt: at('2026-10-04', '18:00'),
      ticketTypes: [],
    },
    {
      id: 'guests-1018',
      showSlug: 'guests',
      venueId: 'vysota',
      startsAt: at('2026-10-18', '18:00'),
      ticketTypes: [],
    },
    {
      id: 'guests-1101',
      showSlug: 'guests',
      venueId: 'vysota',
      startsAt: at('2026-11-01', '18:00'),
      ticketTypes: [],
    },
    {
      id: 'guests-1115',
      showSlug: 'guests',
      venueId: 'vysota',
      startsAt: at('2026-11-15', '18:00'),
      ticketTypes: [],
    },
    {
      id: 'facetoface-1011',
      showSlug: 'facetoface',
      venueId: 'leburg',
      startsAt: at('2026-10-11', '18:00'),
      ticketTypes: [],
    },
    {
      id: 'facetoface-1025',
      showSlug: 'facetoface',
      venueId: 'leburg',
      startsAt: at('2026-10-25', '18:00'),
      ticketTypes: [],
    },
    // Дата и время — с афиши театра (24.10.2026); цен нет — продажи на сайте закрыты.
    {
      id: 'crime-punishment-1123',
      showSlug: 'crime-punishment',
      venueId: 'baton',
      startsAt: at('2026-11-23', '19:00'),
      ticketTypes: [],
    },
    {
      id: 'shakespeare-1024',
      showSlug: 'shakespeare',
      venueId: 'baton',
      startsAt: at('2026-10-24', '18:00'),
      ticketTypes: [],
    },
    {
      id: 'playapt-1009',
      showSlug: 'playapt',
      venueId: 'flat',
      startsAt: at('2026-10-09', '19:30'),
      ticketTypes: [],
    },
    {
      id: 'playapt-1010',
      showSlug: 'playapt',
      venueId: 'flat',
      startsAt: at('2026-10-10', '18:00'),
      ticketTypes: [],
    },
    {
      id: 'playapt-1023',
      showSlug: 'playapt',
      venueId: 'flat',
      startsAt: at('2026-10-23', '19:30'),
      ticketTypes: [],
    },
    {
      id: 'playapt-1030',
      showSlug: 'playapt',
      venueId: 'flat',
      startsAt: at('2026-10-30', '19:30'),
      ticketTypes: [],
    },
    {
      id: 'playapt-1031',
      showSlug: 'playapt',
      venueId: 'flat',
      startsAt: at('2026-10-31', '18:00'),
      ticketTypes: [],
    },
    {
      id: 'vbare2-1015',
      showSlug: 'vbare2',
      venueId: 'dk',
      startsAt: at('2026-10-15', '19:00'),
      ticketTypes: [],
      seating: dkSeatingClosed,
    },
    {
      id: '8women-1020',
      showSlug: '8women',
      venueId: 'dom-aktera',
      startsAt: at('2026-10-20', '19:00'),
      ticketTypes: [],
      // Схема зала есть; цены 7 категорий театр ещё не передал — места видны, продажа закрыта.
      seating: { planId: 'dom-aktera', pricesKopecks: {}, unavailableSeatIds: [] },
    },
    {
      id: 'normalflight-1022',
      showSlug: 'normalflight',
      venueId: 'dk',
      startsAt: at('2026-10-22', '19:00'),
      ticketTypes: [],
      seating: dkSeatingClosed,
    },
    {
      id: 'concertsp-1105',
      showSlug: 'concertsp',
      venueId: 'dk',
      startsAt: at('2026-11-05', '19:00'),
      ticketTypes: [],
      seating: vertinskyNovemberSeating,
    },
    {
      id: 'three-poets-1006',
      showSlug: 'three-poets',
      venueId: 'central-hotel',
      startsAt: at('2026-10-06', '19:00'),
      ticketTypes: threePoetsTickets(0),
    },
    {
      id: 'three-poets-1020',
      showSlug: 'three-poets',
      venueId: 'central-hotel',
      startsAt: at('2026-10-20', '19:00'),
      ticketTypes: threePoetsTickets(17),
    },
    {
      id: 'three-poets-1103',
      showSlug: 'three-poets',
      venueId: 'central-hotel',
      startsAt: at('2026-11-03', '19:00'),
      ticketTypes: threePoetsTickets(20),
    },
    {
      id: 'three-poets-1110',
      showSlug: 'three-poets',
      venueId: 'central-hotel',
      startsAt: at('2026-11-10', '19:00'),
      ticketTypes: threePoetsTickets(0),
    },
  ],
}
