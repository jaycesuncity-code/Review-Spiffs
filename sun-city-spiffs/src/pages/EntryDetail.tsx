import { useEffect, useState } from "react";
import { formatDate } from "../../shared/dates";
import type { Review } from "../../shared/schemas";
import { api } from "../api";
import { draftFromReview, ReviewEditor } from "../components/ReviewEditor";
import { Banner, PageTitle, Spinner, useToast } from "../components/ui";
import { useRouter } from "../router";

export function EntryDetail({ id }: { id: number }) {
  const { navigate } = useRouter();
  const toast = useToast();
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReview(null);
    api<{ review: Review }>(`/api/reviews/${id}`)
      .then((r) => setReview(r.review))
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <Banner tone="error">{error}</Banner>;
  if (!review)
    return (
      <div className="flex justify-center py-16 text-stone-400">
        <Spinner className="size-8" />
      </div>
    );

  return (
    <div>
      <PageTitle
        sub={
          <>
            Posted {formatDate(review.posted_date)} · added by {review.created_by} · last edited by {review.updated_by} {new Date(review.updated_at).toLocaleString()}
          </>
        }
      >
        {review.customer_name}
      </PageTitle>
      <ReviewEditor
        key={review.updated_at}
        mode="edit"
        initial={draftFromReview(review)}
        reviewId={review.id}
        expectedUpdatedAt={review.updated_at}
        onSaved={(r) => {
          toast("Changes saved");
          navigate(`/?month=${r.posted_date.slice(0, 7)}&highlight=${r.id}`);
        }}
        onDeleted={() => navigate(`/?month=${review.posted_date.slice(0, 7)}`)}
      />
    </div>
  );
}
