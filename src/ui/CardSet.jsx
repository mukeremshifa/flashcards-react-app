import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';

import Row from './Row';
import Level from './Level';

const data = {
  title: 'Random set of ten flashcards about random stuff',
  difficluty: 'medium',
  created: '26/05/25',
  cards: [
    {
      front: 'What is the capital of France?',
      back: 'Paris',
    },
    {
      front: 'What is the largest planet in our solar system?',
      back: 'Jupiter',
    },
    {
      front: "Who wrote 'Romeo and Juliet'?",
      back: 'William Shakespeare',
    },
    {
      front: 'What is the chemical symbol for gold?',
      back: 'Au',
    },
    {
      front: 'In which year did World War II end?',
      back: '1945',
    },
    {
      front: 'What is the main component of the Sun?',
      back: 'Hydrogen',
    },
    {
      front: 'Which language is the most spoken worldwide by native speakers?',
      back: 'Mandarin Chinese',
    },
    {
      front: 'What is the square root of 64?',
      back: '8',
    },
    {
      front: "Who painted the 'Mona Lisa'?",
      back: 'Leonardo da Vinci',
    },
    {
      front: 'What is the hardest natural substance on Earth?',
      back: 'Diamond',
    },
  ],
};

function CardSet() {
  const navigate = useNavigate();

  function handleClick() {
    navigate('/practice');
  }

  return (
    <StyledCardsPage>
      <CardestTitle as="h3">{data.title}</CardestTitle>
      <p>{`created ${data.created}`}</p>
      <Row>
        <Row type="horizontal">
          <Level level={data.difficluty}>{data.difficluty}</Level>
          <p>{`${data.cards.length} cards`}</p>
        </Row>

        <CardButton onClick={handleClick}>Practice &gt;</CardButton>
      </Row>
    </StyledCardsPage>
  );
}

// styled components
const StyledCardsPage = styled.div`
  padding: 2.4rem 4rem;
  background-color: var(--color-grey-0);
  border: 1px solid var(--color-grey-100);
  border-radius: var(--border-radius-lg);
  width: clamp(200px, 80vw, 375px);
  min-height: 250px;
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
`;

const CardestTitle = styled.h3`
  font-size: 2rem;
  font-weight: 500;
  line-height: 1.4;
  text-overflow: normal;
  hyphens: none;
`;

const CardButton = styled.button`
  color: var(--color-brand-600);
  font-weight: 500;
  text-align: left;
  transition: all 0.3s;
  background: none;
  border: none;
  padding-left: 0.2rem;

  border-radius: var(--border-radius-sm);

  &:hover,
  &:active {
    color: var(--color-brand-700);
  }
`;

export default CardSet;
