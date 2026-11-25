import * as migration_20261025_195018_initial from './20261025_195018_initial';
import * as migration_20261027_104849_people_works_catalog from './20261027_104849_people_works_catalog';
import * as migration_20261114_200415_refund_claims from './20261114_200415_refund_claims';
import * as migration_20261119_063001_seat_pricing_templates from './20261119_063001_seat_pricing_templates';
import * as migration_20261119_064005_belinskogo_hall from './20261119_064005_belinskogo_hall';
import * as migration_20261119_085320_performance_title from './20261119_085320_performance_title';
import * as migration_20261119_184512_show_seats_per_performance from './20261119_184512_show_seats_per_performance';
import * as migration_20261124_130834_cast_split from './20261124_130834_cast_split';
import * as migration_20261124_132528_gallery_files from './20261124_132528_gallery_files';
import * as migration_20261125_143725_review_links from './20261125_143725_review_links';
import * as migration_20261125_145044_review_no_order from './20261125_145044_review_no_order';
import * as migration_20261125_145531_people_groups from './20261125_145531_people_groups';
import * as migration_20261125_152140_news_rich_body from './20261125_152140_news_rich_body';

export const migrations = [
  {
    up: migration_20261025_195018_initial.up,
    down: migration_20261025_195018_initial.down,
    name: '20261025_195018_initial',
  },
  {
    up: migration_20261027_104849_people_works_catalog.up,
    down: migration_20261027_104849_people_works_catalog.down,
    name: '20261027_104849_people_works_catalog',
  },
  {
    up: migration_20261114_200415_refund_claims.up,
    down: migration_20261114_200415_refund_claims.down,
    name: '20261114_200415_refund_claims',
  },
  {
    up: migration_20261119_063001_seat_pricing_templates.up,
    down: migration_20261119_063001_seat_pricing_templates.down,
    name: '20261119_063001_seat_pricing_templates',
  },
  {
    up: migration_20261119_064005_belinskogo_hall.up,
    down: migration_20261119_064005_belinskogo_hall.down,
    name: '20261119_064005_belinskogo_hall',
  },
  {
    up: migration_20261119_085320_performance_title.up,
    down: migration_20261119_085320_performance_title.down,
    name: '20261119_085320_performance_title',
  },
  {
    up: migration_20261119_184512_show_seats_per_performance.up,
    down: migration_20261119_184512_show_seats_per_performance.down,
    name: '20261119_184512_show_seats_per_performance',
  },
  {
    up: migration_20261124_130834_cast_split.up,
    down: migration_20261124_130834_cast_split.down,
    name: '20261124_130834_cast_split',
  },
  {
    up: migration_20261124_132528_gallery_files.up,
    down: migration_20261124_132528_gallery_files.down,
    name: '20261124_132528_gallery_files',
  },
  {
    up: migration_20261125_143725_review_links.up,
    down: migration_20261125_143725_review_links.down,
    name: '20261125_143725_review_links',
  },
  {
    up: migration_20261125_145044_review_no_order.up,
    down: migration_20261125_145044_review_no_order.down,
    name: '20261125_145044_review_no_order',
  },
  {
    up: migration_20261125_145531_people_groups.up,
    down: migration_20261125_145531_people_groups.down,
    name: '20261125_145531_people_groups',
  },
  {
    up: migration_20261125_152140_news_rich_body.up,
    down: migration_20261125_152140_news_rich_body.down,
    name: '20261125_152140_news_rich_body'
  },
];
