const tee = 'M1 17Q5 6 13 7L32 8 40 3Q37 14 29 14L24 13 22 40 13 48 16 13Q9 12 1 17Z'
const er = 'M2 12 12 6 13 9 23 5Q32 5 34 12L32 22 21 29 12 27 11 40 2 47 5 15ZM13 14 12 23Q20 26 25 20L26 14Q23 8 13 14Z'
const ah = 'M0 44 18 9 28 3 30 39 35 41 26 46 22 43 21 32 11 33 7 43 0 47ZM14 27 21 26 20 15Z'

export default function BrandWordmark() {
  return <svg className="brand-wordmark" viewBox="0 0 300 52" role="img" aria-label="ТРАФАРЕТ" focusable="false" fill="currentColor" fillRule="evenodd">
    <title>ТРАФАРЕТ</title>
    <path d={tee}/><path transform="translate(37)" d={er}/><path transform="translate(71)" d={ah}/>
    <path transform="translate(107)" d="M21 9 30 1 29 11Q38 6 44 14L42 27 30 34 26 33 26 44 17 51 18 35Q8 39 1 30L3 18 14 11 21 12ZM20 17Q13 13 10 20L9 27Q11 33 19 30ZM28 16 27 28Q35 30 36 23L36 18Q34 13 28 16Z"/>
    <path transform="translate(154)" d={ah}/><path transform="translate(193)" d={er}/>
    <path transform="translate(230)" d="M0 12 10 5Q21 11 33 4L28 13Q22 16 14 13L13 23 28 18 24 26 12 28 11 38Q21 42 32 31L29 40 18 46 3 43 6 14Z"/>
    <path transform="translate(260)" d={tee}/>
  </svg>
}
