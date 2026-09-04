## Configuration A - mixed catalogs (200 / 1,000 / 5,000 products)

| VUs | RPS | avg | med | p90 | p95 | p99 | max | Err % | 4xx | 5xx | 429 | t/o | Status |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
| 5 | 11.4 | 39 ms | 11 ms | 75 ms | 139 ms | 595 ms | 838 ms | 0.00 | 18 | 0 | 0 | 0 | PASS |
| 8 | 13.8 | 80 ms | 17 ms | 202 ms | 540 ms | 728 ms | 1533 ms | 0.06 | 1 | 0 | 0 | 0 | DEGRADED |
| 10 | 15.1 | 109 ms | 24 ms | 358 ms | 591 ms | 1006 ms | 2128 ms | 0.08 | 1 | 0 | 0 | 0 | DEGRADED |
| 12 | 18.8 | 133 ms | 38 ms | 514 ms | 686 ms | 899 ms | 1510 ms | 0.14 | 3 | 0 | 0 | 0 | DEGRADED |
| 15 | 18.8 | 227 ms | 86 ms | 710 ms | 908 ms | 1482 ms | 2340 ms | 0.36 | 8 | 0 | 0 | 0 | DEGRADED |
| 20 | 22.1 | 340 ms | 170 ms | 910 ms | 1178 ms | 1701 ms | 2777 ms | 0.16 | 4 | 0 | 0 | 0 | FAIL |
| 25 | 23.0 | 446 ms | 253 ms | 1062 ms | 1446 ms | 2295 ms | 3341 ms | 0.00 | 0 | 0 | 0 | 0 | FAIL |


### System metrics per level (configuration A)

| VUs | Machine CPU avg | Backend CPU (of 1 core) | Event-loop mean | Event-loop max | Backend RSS | Mongo conns | Mongo queries/s | k6 CPU (of machine) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 14.9 % | 35.4 % | 18.0 ms | 673 ms | 629 MB | 90 | 52 | 0.3 % |
| 8 | 27.2 % | 66.9 % | 21.5 ms | 664 ms | 610 MB | 34 | 74 | 0.3 % |
| 10 | 30.4 % | 80.3 % | 23.9 ms | 794 ms | 535 MB | 18 | 85 | 0.4 % |
| 12 | 40.9 % | 102.6 % | 31.6 ms | 1073 ms | 611 MB | 34 | 101 | 0.4 % |
| 15 | 52.3 % | 114.3 % | 40.2 ms | 948 ms | 613 MB | 34 | 103 | 0.5 % |
| 20 | 41.5 % | 122.7 % | 43.8 ms | 1197 ms | 615 MB | 34 | 117 | 0.4 % |
| 25 | 42.7 % | 121.2 % | 46.5 ms | 1440 ms | 550 MB | 35 | 127 | 0.5 % |


## Configuration B - realistic catalog (200 products)

| VUs | RPS | avg | med | p90 | p95 | p99 | max | Err % | 4xx | 5xx | 429 | t/o | Status |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
| 10 | 19.1 | 19 ms | 13 ms | 41 ms | 52 ms | 80 ms | 143 ms | 0.26 | 4 | 0 | 0 | 0 | PASS |
| 25 | 47.6 | 26 ms | 17 ms | 57 ms | 73 ms | 131 ms | 292 ms | 0.23 | 9 | 0 | 0 | 0 | PASS |
| 50 | 73.5 | 188 ms | 165 ms | 334 ms | 394 ms | 559 ms | 1051 ms | 0.00 | 80 | 0 | 0 | 0 | PASS |
| 60 | 76.7 | 276 ms | 246 ms | 463 ms | 550 ms | 778 ms | 1525 ms | 0.00 | 15 | 0 | 0 | 0 | DEGRADED |
| 75 | 77.2 | 430 ms | 397 ms | 671 ms | 757 ms | 965 ms | 1492 ms | 0.00 | 18 | 0 | 0 | 0 | DEGRADED |
| 85 | 75.2 | 557 ms | 517 ms | 867 ms | 983 ms | 1274 ms | 1939 ms | 0.00 | 19 | 0 | 0 | 0 | DEGRADED |
| 100 | 57.0 | 670 ms | 623 ms | 1022 ms | 1233 ms | 1673 ms | 2733 ms | 0.10 | 6 | 0 | 0 | 0 | FAIL |


### System metrics per level (configuration B)

| VUs | Machine CPU avg | Backend CPU (of 1 core) | Event-loop mean | Event-loop max | Backend RSS | Mongo conns | Mongo queries/s | k6 CPU (of machine) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 48.1 % | 31.9 % | 15.1 ms | 53 ms | 608 MB | 34 | 109 | 0.5 % |
| 25 | 28.0 % | 68.3 % | 14.3 ms | 113 ms | 624 MB | 34 | 274 | 0.8 % |
| 50 | 26.4 % | 112.7 % | 23.6 ms | 477 ms | 624 MB | 90 | 386 | 1.4 % |
| 60 | 36.5 % | 110.7 % | 32.5 ms | 260 ms | 630 MB | 90 | 396 | 1.5 % |
| 75 | 32.1 % | 118.3 % | 48.6 ms | 295 ms | 626 MB | 90 | 399 | 1.5 % |
| 85 | 31.8 % | 120.5 % | 56.2 ms | 265 ms | 628 MB | 90 | 390 | 1.3 % |
| 100 | 34.7 % | 119.0 % | 38.8 ms | 315 ms | 621 MB | 90 | 413 | 1.5 % |


## Control run - single client IP, rate limiter as deployed

| VUs | RPS | avg | med | p90 | p95 | p99 | max | Err % | 4xx | 5xx | 429 | t/o | Status |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
| 25 | 41.5 | 5 ms | 1 ms | 2 ms | 3 ms | 28 ms | 977 ms | 99.24 | 3387 | 0 | 3387 | 0 | FAIL |


### Configuration A (mixed catalogs) - endpoints at 5 VUs (highest PASS)

| Endpoint | Requests | RPS | med | p95 | p99 | max | Err % |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `products_search` | 101 | 0.31 | 136 ms | 685 ms | 707 ms | 786 ms | 0.00 |
| `warehouse_manufacturers` | 283 | 0.87 | 118 ms | 602 ms | 650 ms | 838 ms | 0.00 |
| `auth_me` | 696 | 2.13 | 10 ms | 257 ms | 491 ms | 543 ms | 0.00 |
| `auth_login_password` | 13 | 0.04 | 134 ms | 139 ms | 142 ms | 142 ms | 0.00 |
| `products_by_manufacturer` | 54 | 0.17 | 51 ms | 81 ms | 161 ms | 163 ms | 0.00 |
| `warehouse_profile` | 270 | 0.83 | 11 ms | 60 ms | 153 ms | 621 ms | 0.00 |
| `products_list` | 317 | 0.97 | 16 ms | 59 ms | 136 ms | 565 ms | 0.00 |
| `products_page2` | 370 | 1.13 | 12 ms | 36 ms | 126 ms | 541 ms | 0.00 |
| `orders_create` | 53 | 0.16 | 19 ms | 32 ms | 275 ms | 530 ms | 0.00 |
| `orders_returnable` | 142 | 0.44 | 12 ms | 32 ms | 57 ms | 129 ms | 0.00 |
| `returns_list` | 25 | 0.08 | 6 ms | 28 ms | 439 ms | 569 ms | 0.00 |
| `orders_list` | 117 | 0.36 | 11 ms | 24 ms | 109 ms | 534 ms | 0.00 |
| `order_detail` | 148 | 0.45 | 10 ms | 21 ms | 33 ms | 79 ms | 0.00 |
| `categories_list` | 264 | 0.81 | 5 ms | 19 ms | 34 ms | 152 ms | 0.00 |
| `warehouses_list` | 277 | 0.85 | 9 ms | 18 ms | 31 ms | 506 ms | 0.00 |
| `banners_active` | 264 | 0.81 | 5 ms | 17 ms | 136 ms | 538 ms | 0.00 |
| `reviews_create` | 19 | 0.06 | 8 ms | 15 ms | 23 ms | 25 ms | 0.00 |
| `reviews_list` | 38 | 0.12 | 7 ms | 14 ms | 44 ms | 60 ms | 0.00 |
| `warehouse_orders_list` | 6 | 0.02 | 9 ms | 14 ms | 14 ms | 15 ms | 0.00 |
| `exchange_rate` | 264 | 0.81 | 5 ms | 13 ms | 35 ms | 479 ms | 0.00 |


### Configuration A (mixed catalogs) - endpoints at 20 VUs (first FAIL)

| Endpoint | Requests | RPS | med | p95 | p99 | max | Err % |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `products_search` | 86 | 0.74 | 635 ms | 1947 ms | 2617 ms | 2665 ms | 0.00 |
| `orders_create` | 32 | 0.28 | 450 ms | 1663 ms | 1890 ms | 1901 ms | 0.00 |
| `warehouse_manufacturers` | 207 | 1.79 | 371 ms | 1659 ms | 2074 ms | 2409 ms | 0.00 |
| `products_list` | 221 | 1.91 | 249 ms | 1412 ms | 1672 ms | 1780 ms | 0.00 |
| `orders_returnable` | 75 | 0.65 | 137 ms | 1365 ms | 1449 ms | 1458 ms | 0.00 |
| `products_by_manufacturer` | 40 | 0.35 | 324 ms | 1232 ms | 1608 ms | 1844 ms | 0.00 |
| `auth_me` | 476 | 4.11 | 270 ms | 1124 ms | 1250 ms | 1374 ms | 0.00 |
| `warehouse_profile` | 195 | 1.68 | 117 ms | 983 ms | 1417 ms | 1525 ms | 0.00 |
| `products_page2` | 255 | 2.20 | 211 ms | 964 ms | 1482 ms | 2253 ms | 0.00 |
| `orders_list` | 59 | 0.51 | 107 ms | 880 ms | 1209 ms | 1283 ms | 0.00 |
| `order_detail` | 74 | 0.64 | 123 ms | 876 ms | 1462 ms | 1605 ms | 0.00 |
| `warehouses_list` | 199 | 1.72 | 104 ms | 794 ms | 1287 ms | 1374 ms | 0.00 |
| `categories_list` | 190 | 1.64 | 79 ms | 726 ms | 935 ms | 1205 ms | 0.00 |
| `auth_login_password` | 11 | 0.10 | 298 ms | 702 ms | 704 ms | 705 ms | 0.00 |
| `exchange_rate` | 185 | 1.60 | 61 ms | 696 ms | 1283 ms | 1340 ms | 0.00 |
| `reviews_list` | 30 | 0.26 | 64 ms | 671 ms | 974 ms | 1095 ms | 0.00 |
| `reviews_create` | 15 | 0.13 | 135 ms | 666 ms | 912 ms | 974 ms | 0.00 |
| `banners_active` | 187 | 1.62 | 57 ms | 613 ms | 1115 ms | 1328 ms | 0.00 |
| `returns_list` | 14 | 0.12 | 61 ms | 386 ms | 491 ms | 517 ms | 0.00 |
| `warehouse_orders_list` | 6 | 0.05 | 103 ms | 179 ms | 183 ms | 183 ms | 0.00 |


### Configuration B (realistic catalog) - endpoints at 50 VUs (highest PASS)

| Endpoint | Requests | RPS | med | p95 | p99 | max | Err % |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `orders_create` | 405 | 1.09 | 406 ms | 719 ms | 798 ms | 1051 ms | 0.00 |
| `products_by_manufacturer` | 353 | 0.95 | 314 ms | 549 ms | 723 ms | 825 ms | 0.00 |
| `warehouse_profile` | 2052 | 5.51 | 318 ms | 533 ms | 645 ms | 863 ms | 0.00 |
| `products_search` | 757 | 2.03 | 269 ms | 467 ms | 610 ms | 819 ms | 0.00 |
| `warehouse_manufacturers` | 2148 | 5.77 | 231 ms | 410 ms | 543 ms | 730 ms | 0.00 |
| `orders_returnable` | 911 | 2.45 | 208 ms | 385 ms | 493 ms | 722 ms | 0.00 |
| `products_page2` | 2804 | 7.53 | 217 ms | 383 ms | 494 ms | 743 ms | 0.00 |
| `auth_login_password` | 97 | 0.26 | 272 ms | 379 ms | 429 ms | 481 ms | 0.00 |
| `products_list` | 2403 | 6.46 | 214 ms | 373 ms | 466 ms | 772 ms | 0.00 |
| `reviews_create` | 137 | 0.37 | 185 ms | 361 ms | 472 ms | 578 ms | 0.00 |
| `order_detail` | 914 | 2.46 | 171 ms | 314 ms | 408 ms | 657 ms | 0.00 |
| `orders_list` | 693 | 1.86 | 180 ms | 313 ms | 416 ms | 607 ms | 0.00 |
| `auth_me` | 5028 | 13.51 | 142 ms | 264 ms | 361 ms | 635 ms | 0.00 |
| `reviews_list` | 274 | 0.74 | 135 ms | 264 ms | 403 ms | 513 ms | 0.00 |
| `warehouses_list` | 2094 | 5.63 | 138 ms | 255 ms | 347 ms | 627 ms | 0.00 |
| `returns_list` | 218 | 0.59 | 125 ms | 251 ms | 281 ms | 617 ms | 0.00 |
| `warehouse_orders_list` | 52 | 0.14 | 140 ms | 237 ms | 260 ms | 267 ms | 0.00 |
| `categories_list` | 1999 | 5.37 | 107 ms | 209 ms | 295 ms | 460 ms | 0.00 |
| `exchange_rate` | 1997 | 5.37 | 103 ms | 201 ms | 277 ms | 587 ms | 0.00 |
| `banners_active` | 1996 | 5.36 | 100 ms | 198 ms | 276 ms | 547 ms | 0.00 |


### Configuration B (realistic catalog) - endpoints at 100 VUs (first FAIL)

| Endpoint | Requests | RPS | med | p95 | p99 | max | Err % |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `orders_create` | 71 | 0.69 | 1497 ms | 2076 ms | 2552 ms | 2733 ms | 0.00 |
| `products_by_manufacturer` | 76 | 0.74 | 1018 ms | 1833 ms | 1963 ms | 1977 ms | 0.00 |
| `warehouse_profile` | 447 | 4.37 | 1020 ms | 1682 ms | 1951 ms | 2647 ms | 0.00 |
| `warehouse_manufacturers` | 462 | 4.51 | 788 ms | 1299 ms | 1501 ms | 2376 ms | 0.00 |
| `products_list` | 503 | 4.91 | 758 ms | 1291 ms | 1461 ms | 1515 ms | 0.00 |
| `products_search` | 153 | 1.49 | 890 ms | 1248 ms | 1687 ms | 1891 ms | 0.00 |
| `orders_returnable` | 202 | 1.97 | 746 ms | 1197 ms | 1357 ms | 1497 ms | 0.00 |
| `reviews_create` | 46 | 0.45 | 794 ms | 1171 ms | 1374 ms | 1445 ms | 0.00 |
| `products_page2` | 567 | 5.54 | 738 ms | 1117 ms | 1423 ms | 2065 ms | 0.00 |
| `orders_list` | 162 | 1.58 | 618 ms | 1043 ms | 1173 ms | 1290 ms | 0.00 |
| `order_detail` | 213 | 2.08 | 627 ms | 986 ms | 1222 ms | 2136 ms | 0.00 |
| `auth_login_password` | 19 | 0.19 | 605 ms | 943 ms | 1236 ms | 1310 ms | 0.00 |
| `warehouses_list` | 449 | 4.39 | 506 ms | 838 ms | 1037 ms | 1296 ms | 0.00 |
| `reviews_list` | 93 | 0.91 | 526 ms | 816 ms | 927 ms | 972 ms | 0.00 |
| `auth_me` | 1062 | 10.37 | 503 ms | 775 ms | 978 ms | 1912 ms | 0.00 |
| `warehouse_orders_list` | 13 | 0.13 | 483 ms | 754 ms | 824 ms | 841 ms | 0.00 |
| `returns_list` | 40 | 0.39 | 501 ms | 708 ms | 764 ms | 799 ms | 0.00 |
| `categories_list` | 431 | 4.21 | 379 ms | 660 ms | 775 ms | 1031 ms | 0.00 |
| `exchange_rate` | 421 | 4.11 | 372 ms | 600 ms | 779 ms | 810 ms | 0.00 |
| `banners_active` | 418 | 4.08 | 374 ms | 600 ms | 831 ms | 1634 ms | 0.00 |


## Catalog-size scaling (concurrency 1)

| Endpoint | 200 products | 1000 products | 5000 products | linked products | Growth | Response size at linked |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| `products_list_page1` | 20 ms | 19 ms | 22 ms | 19 ms | x1.08 | 6 KB |
| `products_search` | 39 ms | 131 ms | 624 ms | 63 ms | x16.21 | 0 KB |
| `products_search_narrow` | 31 ms | 111 ms | 537 ms | 65 ms | x17.21 | 0 KB |
| `products_by_manufacturer` | 44 ms | 43 ms | 47 ms | 85 ms | x1.05 | 0 KB |
| `warehouse_manufacturers` | 28 ms | 111 ms | 554 ms | 74 ms | x19.91 | 0 KB |
| `warehouse_profile` | 16 ms | 9 ms | 9 ms | 11 ms | x0.61 | 0 KB |


## Socket.IO

**Concurrent connections**

| Target | Established | Success % | Connects/s | connect med | connect p95 | connect max | Dropped | Backend RSS | Event-loop mean |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | 50 | 100.0 | 170.1 | 242 ms | 251 ms | 267 ms | 0 | 622 MB | 15.9 ms |
| 100 | 100 | 100.0 | 153.8 | 190 ms | 198 ms | 198 ms | 0 | 622 MB | 15.9 ms |
| 250 | 250 | 100.0 | 143.7 | 147 ms | 181 ms | 183 ms | 0 | 622 MB | 16.1 ms |
| 500 | 500 | 100.0 | 143.3 | 135 ms | 169 ms | 171 ms | 0 | 621 MB | 16.2 ms |
| 1000 | 1000 | 100.0 | 131.8 | 144 ms | 230 ms | 263 ms | 0 | 621 MB | 16.9 ms |
| 2000 | 2000 | 100.0 | 129.8 | 156 ms | 209 ms | 286 ms | 0 | 621 MB | 17.2 ms |
| 3000 | 3000 | 100.0 | 134.4 | 128 ms | 200 ms | 811 ms | 0 | 593 MB | 17.2 ms |

**Event fan-out (`order.created` into one warehouse room)**

| Listeners | Orders fired | Deliveries | Delivery % | Events/s | fanout med | fanout p95 | fanout max |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 30 | 300 / 300 | 100.00 | 24.4 | 31 ms | 57 ms | 71 ms |
| 100 | 30 | 3000 / 3000 | 100.00 | 242.9 | 32 ms | 44 ms | 47 ms |
| 500 | 30 | 15000 / 15000 | 100.00 | 1157.9 | 41 ms | 58 ms | 68 ms |

**Reconnection storm**

| Connections | Re-established | Success % | Wall time | p95 |
| ---: | ---: | ---: | ---: | ---: |
| 500 | 500 | 100.0 | 1619 ms | 1440 ms |


## Return-photo upload (Cloudinary)

| Concurrency | Uploads | Uploads/s | med | p95 | max | Failed |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 8 | 0.79 | 1106 ms | 2368 ms | 2368 ms | 0 |
| 4 | 32 | 2.12 | 1579 ms | 2203 ms | 2390 ms | 0 |
| 8 | 64 | 4.00 | 1608 ms | 2115 ms | 2486 ms | 0 |


## Login throughput

| Population | Logins | Concurrency | Logins/s | p50 | p95 | max |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| pharmacy | 500 | 32 | 28.72 | 1079 ms | 1211 ms | 2205 ms |
| warehouse | 25 | 32 | 23.61 | 645 ms | 963 ms | 1057 ms |
